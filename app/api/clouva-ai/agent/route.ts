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

type RepositoryContext = {
  scope: "status" | "explicit" | "broad";
  status: unknown;
  tree: string[];
  files: Array<{ path: string; content: string }>;
};

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

async function callGemini(args: {
  apiKey: string;
  model: string;
  instruction: string;
  contents: Array<Record<string, unknown>>;
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

    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? "")
      .join("")
      .trim();

    return text ?? "";
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
}) {
  const fallback =
    process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.1-flash-lite";
  const models = Array.from(new Set([args.selectedModel, fallback]));
  let lastError = "Gemini no respondió.";

  for (const model of models) {
    try {
      const text = await callGemini({ ...args, model });
      if (text) return { text, model };
      lastError = "El modelo respondió sin texto.";
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      const status = (error as Error & { status?: number }).status ?? 500;
      if (!isTransient(status, lastError)) throw error;
    }
  }

  throw new Error(`Ningún modelo respondió. Último error: ${lastError}`);
}

function explicitPaths(message: string) {
  const matches = message.match(
    /(?:app|components|lib|pages|src|public|supabase|scripts|workers|types|hooks|config|docs)\/[A-Za-z0-9_./@-]+\.[A-Za-z0-9]+|package\.json|README\.md|Dockerfile/g,
  );
  return Array.from(new Set(matches ?? [])).slice(0, 6);
}

function wantsBroadReview(message: string) {
  return /(todo el proyecto|proyecto completo|revis[áa] el proyecto|analiz[áa] el proyecto|c[oó]mo avanzar|arquitectura|auditor[ií]a|estado general)/i.test(
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

async function buildRepositoryContext(message: string): Promise<RepositoryContext> {
  const status = await getRepositoryStatus();
  const paths = explicitPaths(message);

  if (paths.length) {
    const files = await Promise.all(
      paths.map(async (path) => {
        const file = await readRepositoryFile(path);
        return { path: file.path, content: file.content.slice(0, 28000) };
      }),
    );

    return { scope: "explicit", status, tree: paths, files };
  }

  if (!wantsBroadReview(message)) {
    return { scope: "status", status, tree: [], files: [] };
  }

  const listing = await listRepositoryFiles();
  const relevant = listing.files
    .filter(
      ({ path, size }) =>
        size <= 100_000 &&
        /\.(ts|tsx|js|jsx|mjs|json|md|sql)$/i.test(path) &&
        !/(node_modules|\.next|package-lock\.json|public\/.*\.(glb|gltf|png|jpg|jpeg|webp|mp3|wav))/i.test(path),
    )
    .sort((a, b) => priorityScore(a.path) - priorityScore(b.path))
    .slice(0, 10);

  const files = await Promise.all(
    relevant.map(async ({ path }) => {
      try {
        const file = await readRepositoryFile(path);
        return { path, content: file.content.slice(0, 14000) };
      } catch (error) {
        return {
          path,
          content: `[No se pudo leer: ${error instanceof Error ? error.message : "error"}]`,
        };
      }
    }),
  );

  return {
    scope: "broad",
    status,
    tree: listing.files.map((item) => item.path).slice(0, 400),
    files,
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
        .limit(10),
      buildRepositoryContext(message),
    ]);

    const memoryText = (memories ?? [])
      .map((item) => `[${item.memory_type}] ${item.title}: ${item.content}`)
      .join("\n");

    const instruction = `Sos CLOUVA AI, agente técnico del repositorio sergioiba11/clouva. Respondé en español rioplatense, directo y basado únicamente en evidencia real. No afirmes haber revisado archivos que no estén en el contexto. Para análisis amplios, indicá qué archivos revisaste, qué funciona, qué está incompleto, problemas principales y próximos pasos priorizados. No modifiques archivos en esta respuesta.\n\nMemoria:\n${memoryText || "Sin memoria guardada."}\n\nContexto real del repositorio:\n${JSON.stringify(repositoryContext)}\n\nContexto de pantalla:\n${JSON.stringify(body.screenContext ?? {})}`;

    const contents: Array<Record<string, unknown>> = [
      ...(body.history ?? []).slice(-5).map((item) => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content.slice(0, 5000) }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    const result = await generateWithFallback({
      apiKey,
      selectedModel,
      instruction,
      contents,
    });

    const pendingAction: PendingAction | null = null;

    return NextResponse.json({
      ok: true,
      message: result.text,
      pendingAction,
      model: result.model,
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
