// Real token streaming from Gemini's `streamGenerateContent?alt=sse`
// endpoint — the one streaming mechanism the Orchestrator uses for both
// "chat" and "project" mode (no per-mode duplicate). Yields plain text
// deltas as they arrive; the caller decides how to relay them onward (here:
// re-framed as the Orchestrator's own NDJSON protocol over the HTTP
// response body — see app/api/clouva-ai/chat/route.ts).

export interface GeminiStreamResult {
  usage: Record<string, unknown> | null;
}

async function* streamOnce(args: {
  apiKey: string;
  model: string;
  instruction: string;
  contents: Array<Record<string, unknown>>;
  temperature?: number;
  maxOutputTokens?: number;
}): AsyncGenerator<string, GeminiStreamResult, void> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:streamGenerateContent?alt=sse`,
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
    },
  );

  if (!response.ok || !response.body) {
    const raw = await response.text().catch(() => "");
    let apiMessage = "";
    try {
      apiMessage = JSON.parse(raw)?.error?.message ?? "";
    } catch {
      // raw wasn't JSON — fall through with the empty message
    }
    const error = new Error(apiMessage || `Gemini respondió HTTP ${response.status}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage: Record<string, unknown> | null = null;
  let sawAnyText = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr) continue;

        let parsed: {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
          usageMetadata?: Record<string, unknown>;
        };
        try {
          parsed = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        if (parsed.usageMetadata) usage = parsed.usageMetadata;
        const text = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        if (text) {
          sawAnyText = true;
          yield text;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!sawAnyText) {
    throw new Error("Gemini no devolvió texto en el stream.");
  }

  return { usage };
}

/** Primary model, falling back to the secondary one — but only if the
 * primary fails before yielding any text. Once real output has started
 * reaching the caller, a mid-stream failure surfaces as an error instead of
 * silently retrying (which would duplicate/confuse whatever the user
 * already saw). */
export async function* streamGeminiWithFallback(args: {
  apiKey: string;
  selectedModel: string;
  instruction: string;
  contents: Array<Record<string, unknown>>;
  temperature?: number;
  maxOutputTokens?: number;
}): AsyncGenerator<string, { model: string; usage: Record<string, unknown> | null }, void> {
  const fallback = process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.1-flash-lite";
  const models = Array.from(new Set([args.selectedModel, fallback]));
  let lastError: Error | null = null;

  for (const model of models) {
    const stream = streamOnce({ ...args, model });
    let yieldedAny = false;
    try {
      while (true) {
        const { value, done } = await stream.next();
        if (done) return { model, usage: value.usage };
        yieldedAny = true;
        yield value;
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (yieldedAny) throw lastError; // already streamed real output — don't retry silently
      // else: try the next model in the list
    }
  }

  throw lastError ?? new Error("Gemini no respondió.");
}
