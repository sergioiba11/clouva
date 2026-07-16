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

function selectedModelFromRequest(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)clouva_gemini_model=([^;]+)/);
  const selected = match ? decodeURIComponent(match[1]) : "";
  if (/^gemini-[a-z0-9._-]+$/i.test(selected)) return selected;
  return process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
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
          message: { type: "STRING" },
          summary: { type: "STRING" },
        },
        required: ["path", "content", "message", "summary"],
      },
    },
  ],
}];

function transient(status: number, message: string) {
  const value = message.toLowerCase();
  return status === 429 || status >= 500 || value.includes("high demand") || value.includes("temporarily") || value.includes("overloaded") || value.includes("unavailable");
}

async function generate(args: {
  apiKey: string;
  model: string;
  instruction: string;
  contents: Array<Record<string, unknown>>;
  includeTools?: boolean;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18_000);

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
          generationConfig: { temperature: 0.35, maxOutputTokens: 3072 },
        }),
        cache: "no-store",
        signal: controller.signal,
      },
    );

    const raw = await response.text();
    const data = raw ? JSON.parse(raw) : {};
    if (!response.ok) {
      const message = data?.error?.message ?? `Gemini respondió HTTP ${response.status}`;
      const error = new Error(message) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("El modelo tardó demasiado en responder.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateWithFallback(args: {
  apiKey: string;
  selectedModel: string;
  instruction: string;
  contents: Array<Record<string, unknown>>;
  includeTools?: boolean;
}) {
  const fallback = process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.1-flash-lite";
  const models = Array.from(new Set([args.selectedModel, fallback]));
  let lastError = "Gemini no respondió.";

  for (const model of models) {
    try {
      const data = await generate({
        apiKey: args.apiKey,
        model,
        instruction: args.instruction,
        contents: args.contents,
        includeTools: args.includeTools,
      });
      return { data, model };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Gemini no respondió.";
      const status = (error as Error & { status?: number }).status ?? 500;
      if (!transient(status, lastError)) throw error;
    }
  }

  throw new Error(`Ninguno de los modelos respondió a tiempo. Último error: ${lastError}`);
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAdmin(request);
    const body = (await request.json()) as RequestBody;
    const message = body.message?.trim();
    if (!message) return NextResponse.json({ error: "Escribí un mensaje." }, { status: 400 });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Falta GEMINI_API_KEY en Railway.");
    const selectedModel = selectedModelFromRequest(request);

    const { data: memories } = await supabase
      .from("project_memory")
      .select("memory_type,title,content,importance")
      .eq("user_id", user.id)
      .eq("project_key", "clouva")
      .eq("status", "active")
      .order("importance", { ascending: false })
      .limit(12);

    const memoryText = (memories ?? [])
      .map((item) => `[${item.memory_type}] ${item.title}: ${item.content}`)
      .join("\n");

    const instruction = `Sos CLOUVA AI, agente técnico del repo sergioiba11/clouva. Respondé en español rioplatense, directo y útil. Nunca digas que leíste un archivo sin usar la herramienta. Para modificar código, primero leé el archivo y después usá propose_file_change. Nunca escribas sin confirmación. Memoria:\n${memoryText || "Sin memoria guardada."}\nContexto:\n${JSON.stringify(body.screenContext ?? {})}`;

    const contents: Array<Record<string, unknown>> = [
      ...(body.history ?? []).slice(-6).map((item) => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    let pendingAction: PendingAction | null = null;
    let usedModel = selectedModel;
    let finalText = "";

    const first = await generateWithFallback({
      apiKey,
      selectedModel,
      instruction,
      contents,
    });
    usedModel = first.model;

    const firstParts = first.data?.candidates?.[0]?.content?.parts ?? [];
    finalText = firstParts.map((part: { text?: string }) => part.text ?? "").join("").trim();

    const calls = firstParts
      .filter((part: { functionCall?: FunctionCall }) => part.functionCall?.name)
      .map((part: { functionCall?: FunctionCall }) => part.functionCall as FunctionCall);

    if (calls.length) {
      contents.push({ role: "model", parts: firstParts });
      const responses: Array<Record<string, unknown>> = [];

      for (const call of calls) {
        let result: unknown;
        if (call.name === "get_repository_status") {
          result = await getRepositoryStatus();
        } else if (call.name === "read_repository_file") {
          const path = String(call.args?.path ?? "").trim();
          if (!path) throw new Error("El modelo no indicó qué archivo leer.");
          const file = await readRepositoryFile(path);
          result = { ...file, content: file.content.slice(0, 35000) };
        } else if (call.name === "propose_file_change") {
          pendingAction = {
            type: "write_file",
            path: String(call.args?.path ?? ""),
            content: String(call.args?.content ?? ""),
            message: String(call.args?.message ?? "chore: actualizar archivo"),
            summary: String(call.args?.summary ?? "Cambio propuesto por CLOUVA AI"),
          };
          result = { requires_confirmation: true, path: pendingAction.path };
        } else {
          result = { error: "Herramienta desconocida" };
        }
        responses.push({ functionResponse: { name: call.name, response: result } });
      }

      if (pendingAction) {
        finalText = `${pendingAction.summary}\n\nPreparé una propuesta para \`${pendingAction.path}\`. Revisala y tocá “Aplicar cambio”.`;
      } else {
        contents.push({ role: "user", parts: responses });
        const second = await generateWithFallback({
          apiKey,
          selectedModel: usedModel,
          instruction: instruction + "\nRespondé ahora con una conclusión final. No llames más herramientas.",
          contents,
          includeTools: false,
        });
        usedModel = second.model;
        finalText = second.data?.candidates?.[0]?.content?.parts
          ?.map((part: { text?: string }) => part.text ?? "")
          .join("")
          .trim() ?? "";
      }
    }

    if (!finalText) throw new Error("El modelo no generó una respuesta útil.");

    return NextResponse.json({ ok: true, message: finalText, pendingAction, model: usedModel });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error inesperado en el agente." },
      { status: 500 },
    );
  }
}
