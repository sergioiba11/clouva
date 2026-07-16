import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getRepositoryStatus, readRepositoryFile } from "@/lib/clouva-ai/github";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatMessage = { role: "user" | "assistant"; content: string };
type RequestBody = { message?: string; history?: ChatMessage[]; screenContext?: Record<string, unknown> };
type PendingAction = { type: "write_file"; path: string; content: string; message: string; summary: string };
type FunctionCall = { name?: string; args?: Record<string, unknown> };

function getSupabase(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Faltan variables públicas de Supabase.");
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireAdmin(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!accessToken) throw new Error("Sesión requerida.");

  const supabase = getSupabase(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Sesión inválida.");

  const allowed = (process.env.CLOUVA_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const email = data.user.email?.toLowerCase();
  if (!email || !allowed.includes(email)) throw new Error("Usuario no autorizado para el agente de código.");

  return { supabase, user: data.user };
}

const tools = [{
  functionDeclarations: [
    {
      name: "get_repository_status",
      description: "Obtiene el repositorio, rama y último push configurados.",
      parameters: { type: "OBJECT", properties: {} },
    },
    {
      name: "read_repository_file",
      description: "Lee un archivo de texto real del repositorio CLOUVA.",
      parameters: {
        type: "OBJECT",
        properties: { path: { type: "STRING", description: "Ruta exacta del archivo" } },
        required: ["path"],
      },
    },
    {
      name: "propose_file_change",
      description: "Propone crear o reemplazar un archivo. No ejecuta el cambio: devuelve una propuesta que el usuario debe confirmar.",
      parameters: {
        type: "OBJECT",
        properties: {
          path: { type: "STRING" },
          content: { type: "STRING" },
          message: { type: "STRING", description: "Mensaje de commit" },
          summary: { type: "STRING", description: "Resumen claro del cambio" },
        },
        required: ["path", "content", "message", "summary"],
      },
    },
  ],
}];

async function callGemini(args: {
  apiKey: string;
  model: string;
  instruction: string;
  contents: Array<Record<string, unknown>>;
  includeTools?: boolean;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": args.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: args.instruction }] },
          contents: args.contents,
          ...(args.includeTools === false ? {} : { tools }),
          generationConfig: { temperature: 0.35, maxOutputTokens: 4096 },
        }),
        cache: "no-store",
        signal: controller.signal,
      },
    );

    const raw = await response.text();
    let data: any = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error("Gemini devolvió una respuesta inválida.");
    }

    if (!response.ok) throw new Error(data?.error?.message ?? `Gemini respondió HTTP ${response.status}`);
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("CLOUVA AI tardó demasiado en responder. Reintentá una vez.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAdmin(request);
    const body = (await request.json()) as RequestBody;
    const message = body.message?.trim();
    if (!message) return NextResponse.json({ error: "Escribí un mensaje." }, { status: 400 });

    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
    if (!apiKey) throw new Error("Falta GEMINI_API_KEY en Railway.");

    const { data: memories } = await supabase
      .from("project_memory")
      .select("memory_type,title,content,importance")
      .eq("user_id", user.id)
      .eq("project_key", "clouva")
      .eq("status", "active")
      .order("importance", { ascending: false })
      .limit(20);

    const memoryText = (memories ?? [])
      .map((item) => `[${item.memory_type}] ${item.title}: ${item.content}`)
      .join("\n");

    const contents: Array<Record<string, unknown>> = [
      ...(body.history ?? []).slice(-8).map((item) => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    const instruction = `Sos CLOUVA AI, agente técnico del repo sergioiba11/clouva. Tenés herramientas reales para consultar estado y leer archivos. Nunca afirmes que leíste un archivo sin usar la herramienta. Si el usuario pide leer o analizar un archivo, usá read_repository_file y después SIEMPRE devolvé una explicación concreta. Para modificar código, primero leé los archivos relevantes y después usá propose_file_change. Esa herramienta NO escribe: genera una propuesta que el usuario confirma con un botón. No propongas cambios destructivos ni secretos. Respondé en español rioplatense, directo y útil. Memoria del proyecto:\n${memoryText || "Sin memoria guardada."}\nContexto de pantalla:\n${JSON.stringify(body.screenContext ?? {})}`;

    let pendingAction: PendingAction | null = null;
    let finalText = "";
    let usedTool = false;

    for (let step = 0; step < 6; step += 1) {
      const data = await callGemini({ apiKey, model, instruction, contents });
      const candidate = data?.candidates?.[0]?.content;
      const parts = candidate?.parts ?? [];
      const text = parts.map((part: { text?: string }) => part.text ?? "").join("").trim();
      if (text) finalText = text;

      const functionCalls = parts
        .filter((part: { functionCall?: FunctionCall }) => part.functionCall?.name)
        .map((part: { functionCall?: FunctionCall }) => part.functionCall as FunctionCall);

      if (!functionCalls.length) break;
      usedTool = true;
      contents.push({ role: "model", parts });

      const responseParts: Array<Record<string, unknown>> = [];

      for (const functionCall of functionCalls) {
        let toolResult: unknown;

        if (functionCall.name === "get_repository_status") {
          toolResult = await getRepositoryStatus();
        } else if (functionCall.name === "read_repository_file") {
          const path = String(functionCall.args?.path ?? "").trim();
          if (!path) throw new Error("CLOUVA AI intentó leer un archivo sin indicar la ruta.");
          const file = await readRepositoryFile(path);
          toolResult = { ...file, content: file.content.slice(0, 40000) };
        } else if (functionCall.name === "propose_file_change") {
          pendingAction = {
            type: "write_file",
            path: String(functionCall.args?.path ?? ""),
            content: String(functionCall.args?.content ?? ""),
            message: String(functionCall.args?.message ?? "chore: actualizar archivo"),
            summary: String(functionCall.args?.summary ?? "Cambio propuesto por CLOUVA AI"),
          };
          toolResult = { accepted: true, requires_confirmation: true, path: pendingAction.path };
        } else {
          toolResult = { error: "Herramienta desconocida" };
        }

        responseParts.push({
          functionResponse: { name: functionCall.name, response: toolResult },
        });
      }

      contents.push({ role: "user", parts: responseParts });

      if (pendingAction) {
        finalText = `${pendingAction.summary}\n\nPreparé una propuesta para \`${pendingAction.path}\`. Revisala y tocá “Aplicar cambio” para crear el commit.`;
        break;
      }
    }

    if (!finalText && usedTool && !pendingAction) {
      contents.push({
        role: "user",
        parts: [{ text: "Con la información de las herramientas que ya recibiste, respondé ahora al pedido del usuario sin llamar más herramientas." }],
      });
      const fallback = await callGemini({
        apiKey,
        model,
        instruction,
        contents,
        includeTools: false,
      });
      finalText = fallback?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text ?? "")
        .join("")
        .trim() ?? "";
    }

    if (!finalText) {
      throw new Error("CLOUVA AI no pudo completar el análisis. Reintentá el mismo mensaje una vez.");
    }

    return NextResponse.json({ ok: true, message: finalText, pendingAction, model });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error inesperado en el agente." },
      { status: 500 },
    );
  }
}
