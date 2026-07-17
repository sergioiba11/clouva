import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  getRepositoryStatus,
  listRepositoryFiles,
  readRepositoryFile,
} from "@/lib/clouva-ai/github";
import {
  CLOUVA_PRODUCT_CONTEXT,
  CLOUVA_REPOSITORY_AGENT_PROMPT,
} from "@/lib/clouva-ai/vision";

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
type RepositoryFile = { path: string; content: string };
type RepositoryContext = {
  scope: "status" | "explicit" | "broad";
  status: unknown;
  tree: string[];
  files: RepositoryFile[];
  coverageAreas: string[];
};
type GeminiPayload = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: Record<string, unknown>;
  error?: { message?: string };
};

const BROAD_REVIEW_GROUPS: Array<{
  area: string;
  patterns: RegExp[];
}> = [
  {
    area: "visión y documentación",
    patterns: [
      /^docs\/CLOUVA_VISION\.md$/,
      /^docs\/CLOUVA_PROJECT_AUDIT\.md$/,
      /^README\.md$/,
    ],
  },
  {
    area: "configuración y deploy",
    patterns: [
      /^package\.json$/,
      /^next\.config\./,
      /^\.env\.example$/,
      /^scripts\/prepare-clouva-model\.mjs$/,
    ],
  },
  {
    area: "identidad y permisos",
    patterns: [
      /^components\/auth-provider\.tsx$/,
      /^lib\/auth\.ts$/,
      /supabase\/migrations\/.*role/i,
    ],
  },
  {
    area: "home e identidad inmersiva",
    patterns: [
      /^components\/clouva\/AvatarScene\.tsx$/,
      /^components\/clouva\/MinimalNavigation\.tsx$/,
      /^app\/layout\.tsx$/,
    ],
  },
  {
    area: "perfil y comunidad",
    patterns: [
      /^app\/u\/\[username\]\/page\.tsx$/,
      /^app\/mi-flow\/page\.tsx$/,
      /follow/i,
    ],
  },
  {
    area: "avatar e inventario 3D",
    patterns: [
      /^components\/avatar-engine\/AvatarModelViewer\.tsx$/,
      /^components\/avatar-engine\/OutfitPreview\.tsx$/,
      /^lib\/avatar-engine\//,
    ],
  },
  {
    area: "Creator Studio",
    patterns: [
      /^components\/creator-studio\/CreatorStudio\.tsx$/,
      /^components\/creator-studio\/SmartTryOnViewer\.tsx$/,
      /^components\/creator-studio\/CreatorStudioV2Panel\.tsx$/,
    ],
  },
  {
    area: "pipeline Blender",
    patterns: [
      /^app\/api\/creator-studio\/blender\/route\.ts$/,
      /^worker\/garment-rig\/app\.py$/,
      /^worker\/garment-rig\/rig_garment\.py$/,
    ],
  },
  {
    area: "tienda y economía",
    patterns: [
      /^app\/tienda\//,
      /^app\/catalogo\//,
      /^lib\/store-/,
      /editable_store\.sql$/,
    ],
  },
  {
    area: "música",
    patterns: [/spotify/i, /music/i],
  },
  {
    area: "Trébol y Gemini",
    patterns: [
      /^app\/api\/gemini\/route\.ts$/,
      /^app\/api\/clouva-ai\/agent\/route\.ts$/,
      /^components\/clouva-ai\/ClouvaAIChat\.tsx$/,
    ],
  },
];

function getSupabase(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Faltan variables públicas de Supabase.");
  }

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
    throw new Error("Usuario no autorizado para el modo Proyecto.");
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
    value.includes("unavailable") ||
    value.includes("tardó demasiado")
  );
}

async function callGemini(args: {
  apiKey: string;
  model: string;
  instruction: string;
  contents: Array<Record<string, unknown>>;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18_000);

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
          generationConfig: {
            temperature: 0.25,
            maxOutputTokens: 6000,
          },
        }),
        cache: "no-store",
        signal: controller.signal,
      },
    );

    const raw = await response.text();
    let data: GeminiPayload = {};
    try {
      data = raw ? (JSON.parse(raw) as GeminiPayload) : {};
    } catch {
      throw new Error("Gemini devolvió una respuesta inválida.");
    }

    if (!response.ok) {
      const error = new Error(
        data.error?.message ?? `Gemini respondió HTTP ${response.status}`,
      ) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    const text = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!text) {
      const reason = data.candidates?.[0]?.finishReason;
      throw new Error(
        reason
          ? `Gemini terminó sin informe (${reason}).`
          : "Gemini respondió sin texto.",
      );
    }

    return { text, usage: data.usageMetadata ?? null };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      const timeoutError = new Error(
        `El modelo ${args.model} tardó demasiado en responder.`,
      ) as Error & { status?: number };
      timeoutError.status = 504;
      throw timeoutError;
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
      const result = await callGemini({ ...args, model });
      return { ...result, model };
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
    /(?:app|components|lib|pages|src|public|supabase|scripts|worker|workers|types|hooks|config|docs)\/[A-Za-z0-9_./@\[\]-]+\.[A-Za-z0-9]+|package\.json|README\.md|Dockerfile|\.env\.example/g,
  );
  return Array.from(new Set(matches ?? [])).slice(0, 8);
}

function wantsBroadReview(message: string) {
  return /(todo el proyecto|proyecto completo|revis[áa] el proyecto|analiz[áa] el proyecto|c[oó]mo avanzar|arquitectura|auditor[ií]a|estado general|visi[oó]n|roadmap|prioridades|investigaci[oó]n)/i.test(
    message,
  );
}

function isReadableSource(path: string, size: number) {
  return (
    size <= 150_000 &&
    /\.(ts|tsx|js|jsx|mjs|json|md|sql|py)$/i.test(path) &&
    !/(node_modules|\.next|package-lock\.json|public\/.*\.(glb|gltf|png|jpg|jpeg|webp|mp3|wav))/i.test(
      path,
    )
  );
}

function chooseBroadReviewPaths(
  files: Array<{ path: string; size: number }>,
) {
  const available = files.filter(({ path, size }) =>
    isReadableSource(path, size),
  );
  const selected: string[] = [];
  const coverageAreas: string[] = [];

  for (const group of BROAD_REVIEW_GROUPS) {
    const match = group.patterns
      .map((pattern) => available.find((file) => pattern.test(file.path)))
      .find(Boolean);

    if (match && !selected.includes(match.path)) {
      selected.push(match.path);
      coverageAreas.push(group.area);
    }
  }

  const required = [
    "docs/CLOUVA_VISION.md",
    "docs/CLOUVA_PROJECT_AUDIT.md",
    "package.json",
    "README.md",
  ];

  for (const path of required) {
    if (
      available.some((file) => file.path === path) &&
      !selected.includes(path)
    ) {
      selected.unshift(path);
    }
  }

  return {
    paths: selected.slice(0, 14),
    coverageAreas,
  };
}

async function readFiles(paths: string[], limit: number) {
  return Promise.all(
    paths.map(async (path): Promise<RepositoryFile> => {
      try {
        const file = await readRepositoryFile(path);
        return { path: file.path, content: file.content.slice(0, limit) };
      } catch (error) {
        return {
          path,
          content: `[No se pudo leer: ${
            error instanceof Error ? error.message : "error desconocido"
          }]`,
        };
      }
    }),
  );
}

async function buildRepositoryContext(
  message: string,
): Promise<RepositoryContext> {
  const status = await getRepositoryStatus();
  const paths = explicitPaths(message);

  if (paths.length) {
    return {
      scope: "explicit",
      status,
      tree: paths,
      files: await readFiles(paths, 30_000),
      coverageAreas: ["archivos solicitados explícitamente"],
    };
  }

  if (!wantsBroadReview(message)) {
    return {
      scope: "status",
      status,
      tree: [],
      files: [],
      coverageAreas: ["estado del repositorio"],
    };
  }

  const listing = await listRepositoryFiles();
  const selection = chooseBroadReviewPaths(listing.files);

  return {
    scope: "broad",
    status,
    tree: listing.files.map((item) => item.path).slice(0, 600),
    files: await readFiles(selection.paths, 14_000),
    coverageAreas: selection.coverageAreas,
  };
}

function deterministicFallback(context: RepositoryContext) {
  const reviewed = context.files.map((file) => `- ${file.path}`).join("\n");
  return `La lectura real de GitHub terminó, pero Gemini no produjo el informe.\n\nAlcance real: ${context.scope}.\nÁreas cubiertas: ${context.coverageAreas.join(", ") || "sin áreas adicionales"}.\n\nArchivos leídos:\n${reviewed || "- Ningún archivo; solamente estado del repositorio."}\n\nReintentá con una pregunta más acotada o pedí continuar por un área concreta. No se modificó ningún archivo.`;
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

    const instruction = `${CLOUVA_REPOSITORY_AGENT_PROMPT}\n\nMEMORIA PERSISTENTE DEL PROYECTO\n${memoryText || "Sin memoria adicional guardada."}\n\nALCANCE OBTENIDO EN ESTA CONSULTA\n${JSON.stringify({
      scope: repositoryContext.scope,
      coverageAreas: repositoryContext.coverageAreas,
      repositoryStatus: repositoryContext.status,
      filesReviewed: repositoryContext.files.map((file) => file.path),
    })}\n\nCONTEXTO REAL DE GITHUB\n${JSON.stringify(repositoryContext)}\n\nCONTEXTO DE PANTALLA\n${JSON.stringify(body.screenContext ?? {})}\n\nRecordatorio de visión estable:\n${CLOUVA_PRODUCT_CONTEXT}`;

    const contents: Array<Record<string, unknown>> = [
      ...(body.history ?? []).slice(-6).map((item) => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content.slice(0, 6000) }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    let result: {
      text: string;
      model: string;
      usage: Record<string, unknown> | null;
    } | null = null;

    try {
      result = await generateWithFallback({
        apiKey,
        selectedModel,
        instruction,
        contents,
      });
    } catch (error) {
      if (!repositoryContext.files.length) throw error;
    }

    const pendingAction: PendingAction | null = null;

    return NextResponse.json({
      ok: true,
      message: result?.text ?? deterministicFallback(repositoryContext),
      pendingAction,
      model: result?.model ?? selectedModel,
      usage: result?.usage ?? null,
      analysisScope: repositoryContext.scope,
      coverageAreas: repositoryContext.coverageAreas,
      filesReviewed: repositoryContext.files.map((file) => file.path),
      assistant: "Trébol — CLOUVA AI",
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
