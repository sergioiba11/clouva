import { isTransientGeminiError } from "@/lib/clouva-ai/gemini-text";

type GroundedPayload = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
    groundingMetadata?: {
      webSearchQueries?: string[];
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    };
  }>;
  usageMetadata?: Record<string, unknown>;
  error?: { message?: string };
};

export type GroundedSource = { title: string; url: string };

async function callGroundedGemini(args: {
  apiKey: string;
  model: string;
  instruction: string;
  prompt: string;
  maxOutputTokens?: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 22_000);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": args.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: args.instruction }] },
          contents: [{ role: "user", parts: [{ text: args.prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.25,
            maxOutputTokens: args.maxOutputTokens ?? 1800,
          },
        }),
        cache: "no-store",
        signal: controller.signal,
      },
    );

    const raw = await response.text();
    let data: GroundedPayload = {};
    try {
      data = raw ? JSON.parse(raw) as GroundedPayload : {};
    } catch {
      throw new Error("Gemini devolvió una respuesta inválida.");
    }
    if (!response.ok) {
      const error = new Error(data.error?.message || `Gemini respondió HTTP ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }

    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((part) => part.text || "").join("").trim();
    if (!text) throw new Error(candidate?.finishReason ? `Gemini terminó sin texto (${candidate.finishReason}).` : "Gemini respondió sin texto.");

    const sources: GroundedSource[] = [];
    const seen = new Set<string>();
    for (const chunk of candidate?.groundingMetadata?.groundingChunks || []) {
      const url = chunk.web?.uri?.trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      sources.push({ title: chunk.web?.title?.trim() || new URL(url).hostname, url });
      if (sources.length >= 8) break;
    }
    return {
      text,
      sources,
      searches: candidate?.groundingMetadata?.webSearchQueries || [],
      usage: data.usageMetadata || null,
    };
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

export async function generateGroundedWithFallback(args: {
  apiKey: string;
  selectedModel: string;
  instruction: string;
  prompt: string;
  maxOutputTokens?: number;
}) {
  const fallback = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite";
  const models = Array.from(new Set([args.selectedModel, fallback]));
  let lastError = "Gemini no respondió.";
  for (const model of models) {
    try {
      const result = await callGroundedGemini({ ...args, model });
      return { ...result, model };
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      const status = (error as Error & { status?: number }).status ?? 500;
      if (!isTransientGeminiError(status, lastError)) throw error;
    }
  }
  throw new Error(`Ningún modelo respondió. Último error: ${lastError}`);
}
