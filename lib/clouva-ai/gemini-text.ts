// Non-streaming Gemini text generation with primary/fallback model retry —
// shared by the legacy app/api/clouva-ai/agent/route.ts and the canonical
// Orchestrator (app/api/clouva-ai/chat/route.ts) so there's exactly one
// implementation of "call Gemini, retry on a transient failure with the
// fallback model" instead of one copy per route.

export type GeminiPayload = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: Record<string, unknown>;
  error?: { message?: string };
};

export function isTransientGeminiError(status: number, message: string) {
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
  maxOutputTokens?: number;
  temperature?: number;
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
          generationConfig: {
            temperature: args.temperature ?? 0.45,
            maxOutputTokens: args.maxOutputTokens ?? 4096,
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
      const error = new Error(data.error?.message ?? `Gemini respondió HTTP ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    const text = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!text) {
      const reason = data.candidates?.[0]?.finishReason;
      throw new Error(reason ? `Gemini terminó sin texto (${reason}).` : "Gemini respondió sin texto.");
    }

    return { text, usage: data.usageMetadata ?? null };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      const timeoutError = new Error(`El modelo ${args.model} tardó demasiado en responder.`) as Error & { status?: number };
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateWithFallback(args: {
  apiKey: string;
  selectedModel: string;
  instruction: string;
  contents: Array<Record<string, unknown>>;
  maxOutputTokens?: number;
  temperature?: number;
}) {
  const fallback = process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.1-flash-lite";
  const models = Array.from(new Set([args.selectedModel, fallback]));
  let lastError = "Gemini no respondió.";

  for (const model of models) {
    try {
      const result = await callGemini({ ...args, model });
      return { ...result, model };
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      const status = (error as Error & { status?: number }).status ?? 500;
      if (!isTransientGeminiError(status, lastError)) throw error;
    }
  }

  throw new Error(`Ningún modelo respondió. Último error: ${lastError}`);
}

export function selectedModelFromRequest(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(/(?:^|;\s*)clouva_gemini_model=([^;]+)/);
  const selected = match ? decodeURIComponent(match[1]) : "";
  if (/^gemini-[a-z0-9._-]+$/i.test(selected)) return selected;
  return process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
}
