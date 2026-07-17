import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  getRepositoryStatus,
  listRepositoryFiles,
  readRepositoryFile,
} from "@/lib/clouva-ai/github";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatMessage = { role: "user" | "assistant"; content: string };
type RequestBody = {
  message?: string;
  history?: ChatMessage[];
  screenContext?: Record<string, unknown>;
};
type PendingAction = {
  type: "write_file";
  path: string;
  content: string;
  message: string;
  summary: string;
};
type FunctionCall = { name?: string; args?: Record<string, unknown> };

type GeminiResult = {
  data: any;
  model: string;
};

const EDIT_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "read_repository_file",
        description: "Lee un archivo de texto real del repositorio CLOUVA.",
        parameters: {
          type: "OBJECT",
          properties: { path: { type: "STRING" } },
          required: ["path"],
        },
      },
      {
        name: "propose_file_change",
        description:
          "Propone crear o reemplazar un archivo. No escribe: requiere confirmación del usuario.",
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
  },
];

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
  const accessToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!accessToken) throw new Error("Sesión requerida.");

  const supabase = getSupabase(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Sesión inválida.");

  const allowed = (process.env.CLOUVA_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const email = data.user.email?.toLowerCase();
  if (!email || !allowed.includes(email)) {
    throw new Error("Usuario no autorizado para el agente de código.");
  }

  return { supabase, user: data.user };
}

function selectedModelFromRequest(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)clouva_gemini_model=([^;]+)/);
  const selected = match ? decodeURIComponent(match[1]) : "";
  if (/^gemini-[a-z0-9._-]+$/i.test(selected)) return selected;
  return process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
}

function isTransient(status: number, message: string) {
  const value = message.toLowerCase();
  return (
    status === 429 ||
    status >= 500 ||
    value.includes("high demand") ||
    value.includes("temporarily") ||
    value.includes("overloaded") ||
    value.includes("unavailable")
  );
}

async function generate(args: {
  apiKey: string;
  model: string;
  instruction: string;
  contents: Array<Record<string, unknown>>;
  tools?: typeof EDIT_TOOLS;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 22_000);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": args.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: args.instruction }] },
          contents: args.contents,
          ...(args.tools ? { tools: args.tools } : {}),
          generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
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

    if (!response.ok) {
      const error = new Error(
        data?.error?.message ?? `Gemini respondió HTTP ${response.status}`,
      ) as Error & { status?: number };
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
  tools?: typeof EDIT_TOOLS;
}): Promise<GeminiResult> {
  const fallback =
    process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.1-flash-lite";
  const models = Array.from(new Set([args.selectedModel, fallback]));
  let lastError = "Gemini no respondió.";

  for (const model of models) {
    try {
      const data = await generate({ ...args, model });
      return { data, model };
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      const status = (error as Error & { status?: number }).status ?? 500;
      if (!isTransient(status, lastError)) throw error;
    }
  }

  throw new Error(`Ningún modelo respondió. Último error: ${lastError}`);
}

function extractText(data: any) {
  return (
    data?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

function explicitPaths(message: string) {
  return Array.from(
    new Set(
      message.match(
        /(?:app|components|lib|pages|src|public|supabase|scripts|workers|types|hooks|config|docs)\/[A-Za-z0-9_./@-]+\.[A-Za-z0-9]+|(?:^|\s)(package\.json|next\.config\.[A-Za-z0-9]+|README\.md|Dockerfile)/g,
      ) ?? [],
    ),
  ).map((path) => path.trim());
}

function wantsBroadReview(message: string) {
  return /(todo el proyecto|proyecto completo|revis[áa] el proyecto|analiz[áa] el proyecto|c[oó]mo avanzar|arquitectura|auditor[ií]a|estado general)/i.test(
    message,
  );
}

function wantsModification(message: string) {
  return /(modific|cambi|implement|arregl|correg|cre[áa]|agreg|elimin|refactor|hacelo|aplic)/i.test(
    message,
  );
}

function priorityScore(path: string) {
  const priorities = [
    /^package\.json$/,
    /^README\.md$/,
    /^next\.config\./,
    /^app\/page\.tsx$/,
    /^app\/layout\.tsx$/,
    /^app\/api\//,
    /^components\/clouva-ai\//,
    /^lib\/clouva-ai\//,
    /avatar/i,
    /rig/i,
    /meshy/i,
    /export/i,
    /supabase/i,
  ];
  const index = priorities.findIndex((pattern) => pattern.test(path));
  return index === -1 ? 999 : index;
}

async function buildRepositoryContext(message: string) {
  const status = await getRepositoryStatus();
  const requestedPaths = explicitPaths(message);

  if (requestedPaths.length) {
    const files = await Promise.all(
      requestedPaths.slice(0, 6).map(async (path) => {
        const file = await readRepositoryFile(path);
        return { path: file.path, content: file.content.slice(0, 30000) };
      }),
    );
    return {
      status,
      tree: requestedPaths,
      files,
      scope: "explicit",
    };
  }

  if (!wantsBroadReview(message)) {
    return { status, tree: [], files: [], scope: "status" };
  }

  const listing = await listRepositoryFiles();
  const relevant = listing.files
    .filter(
      ({ path, size }) =>
        size <= 120_000 &&
        /\.(ts|tsx|js|jsx|mjs|json|md|sql)$/i.test(path) &&
        !/(node_modules|\.next|package-lock\.json|public\/.*\.(glb|gltf|png|jpg|jpeg|webp|mp3|wav))/i.test(path),
    )
    .sort((a, b) => priorityScore(a.path) - priorityScore(b.path))
    .slice(0, 12);

  const files = await Promise.all(
    relevant.map(async ({ path }) => {
      try {
        const file = await readRepositoryFile(path);
        return { path, content: file.content.slice(0, 16000) };
      } catch (error) {
        return {
          path,
          content: `[No se pudo leer: ${error instanceof Error ? error.message : "error"}]`,
        };
      }
    }),
  );

  return {
    status,
    tree: listing.files.map((item) => item.path).slice(0, 500),
    files,
    scope: "broad",
    truncated: listing.truncated,
  };
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireAdmin(request);
    const body = (await request.json()) as RequestBody;
    const message = body.message?.trim();
    if (!message) {
      return NextResponse.json({ error: "Escribí un mensaje." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("Falta GEMINI_API_KEY en Railway.");
    const selectedModel = selectedModelFromRequest(request);

    const [{ data: memories }, repositoryContext] = await Promise.all([
      supabase
        .from("project_memory")
        .select("memory_type,title,content,importance")
        .eq("user_id", user.id)
        .eq("project_key", "clouva")
        .eq("status", "active")
        .order("importance", { ascending: false })
        .limit(12),
      buildRepositoryContext(message),
    ]);

    const memoryText = (memories ?? [])
      .map((item) => `[${item.memory_type}] ${item.title}: ${item.content}`)
      .join("\n");

    const repositoryText = JSON.stringify(repositoryContext);
    const instruction = `Sos CLOUVA AI, agente técnico del repositorio sergioiba11/clouva. Respondé en español rioplatense, directo y basado únicamente en evidencia real. Ya recibiste un inventario y archivos reales del repositorio cuando eran necesarios. No afirmes haber revisado archivos que no aparecen en el contexto. Para análisis amplios: explicá qué revisaste, estado actual, problemas, prioridades y próximos pasos concretos. Si el alcance excede los archivos leídos, decilo y proponé la siguiente tanda. Para cambios de código, leé primero el archivo con la herramienta y después usá propose_file_change. Nunca escribas sin confirmación.\n\nMemoria del proyecto:\n${memoryText || "Sin memoria guardada."}\n\nContexto real del repositorio:\n${repositoryText}\n\nContexto de pantalla:\n${JSON.stringify(body.screenContext ?? {})}`;

    const contents: Array<Record<string, unknown>> = [
      ...(body.history ?? []).slice(-6).map((item) => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content.slice(0, 6000) }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    let pendingAction: PendingAction | null = null;
    let usedModel = selectedModel;
    let finalText = "";

    if (!wantsModification(message)) {
      const result = await generateWithFallback({
        apiKey,
        selectedModel,
        instruction,
        contents,
      });
      usedModel = result.model;
      finalText = extractText(result.data);
    } else {
      for (let step = 0; step < 3; step += 1) {
        const result = await generateWithFallback({
          apiKey,
          selectedModel: usedModel,
          instruction,
          contents,
          tools: EDIT_TOOLS,
        });
        usedModel = result.model;
        const parts = result.data?.candidates?.[0]?.content?.parts ?? [];
        const text = parts
          .map((part: { text?: string }) => part.text ?? "")
          .join("")
          .trim();
        if (text) finalText = text;

        const calls = parts
          .filter((part: { functionCall?: FunctionCall }) => part.functionCall?.name)
          .map((part: { functionCall?: FunctionCall }) =>
            part.functionCall as FunctionCall,
          );
        if (!calls.length) break;

        contents.push({ role: "model", parts });
        const responses: Array<Record<string, unknown>> = [];

        for (const call of calls) {
          let toolResult: unknown;
          if (call.name === "read_repository_file") {
            const path = String(call.args?.path ?? "").trim();
            if (!path) throw new Error("El modelo no indicó qué archivo leer.");
            const file = await readRepositoryFile(path);
            toolResult = { ...file, content: file.content.slice(0, 35000) };
          } else if (call.name === "propose_file_change") {
            pendingAction = {
              type: "write_file",
              path: String(call.args?.path ?? ""),
              content: String(call.args?.content ?? ""),
              message: String(
                call.args?.message ?? "chore: actualizar archivo",
              ),
              summary: String(
                call.args?.summary ?? "Cambio propuesto por CLOUVA AI",
              ),
            };
            toolResult = {
              requires_confirmation: true,
              path: pendingAction.path,
            };
          } else {
            toolResult = { error: "Herramienta desconocida" };
          }

          responses.push({
            functionResponse: { name: call.name, response: toolResult },
          });
        }

        if (pendingAction) {
          finalText = `${pendingAction.summary}\n\nPreparé una propuesta para \`${pendingAction.path}\`. Revisala y tocá “Aplicar cambio”.`;
          break;
        }

        contents.push({ role: "user", parts: responses });
      }
    }

    if (!finalText) {
      finalText =
        repositoryContext.scope === "broad"
          ? "Pude leer el inventario del repositorio, pero el modelo no produjo el informe final. Probá nuevamente con una parte concreta, por ejemplo: ‘revisá arquitectura, avatar 3D y exportación’."
          : "El modelo no produjo texto. Indicá un archivo o una tarea más concreta.";
    }

    return NextResponse.json({
      ok: true,
      message: finalText,
      pendingAction,
      model: usedModel,
      analysisScope: repositoryContext.scope,
      filesReviewed: repositoryContext.files.map((file) => file.path),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Error inesperado en el agente.",
      },
      { status: 500 },
    );
  }
}
