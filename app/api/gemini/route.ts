import { NextRequest, NextResponse } from "next/server";
import { CLOUVA_CHAT_SYSTEM_PROMPT } from "@/lib/clouva-ai/vision";

export const runtime = "nodejs";
export const maxDuration = 35;

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

type ChatMessage = { role: "user" | "assistant"; content: string };
type RequestBody = { message?: string; history?: ChatMessage[] };
type GeminiPayload = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  error?: { message?: string };
};

function selectedModel(request: NextRequest) {
  const selected = request.cookies.get("clouva_gemini_model")?.value ?? "";
  if (/^gemini-[a-z0-9._-]+$/i.test(selected)) return selected;
  return process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
}

function isTransient(status: number, message: string) {
  const value = message.toLowerCase();
  return (
    status === 429 ||
    status >= 500 ||
    value.includes("high demand") ||
    value.includes("overloaded") ||
    value.includes("temporarily") ||
    value.includes("unavailable") ||
    value.includes("timed out") ||
    value.includes("tardó demasiado")
  );
}

async function callModel(args: {
  apiKey: string;
  model: string;
  contents: Array<Record<string, unknown>>;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 16_000);

  try {
    const response = await fetch(
      `${ENDPOINT}/${encodeURIComponent(args.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": args.apiKey,
        },
        body: JSON.stringify({
          // El contexto compartido se mantiene al principio y sin cambios para que
          // Gemini pueda aprovechar el caching implícito cuando corresponda.
          systemInstruction: {
            parts: [{ text: CLOUVA_CHAT_SYSTEM_PROMPT }],
          },
          contents: args.contents,
          generationConfig: {
            temperature: 0.45,
            maxOutputTokens: 4096,
          },
        }),
        signal: controller.signal,
        cache: "no-store",
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

    const reply = data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!reply) {
      const finishReason = data.candidates?.[0]?.finishReason;
      throw new Error(
        finishReason
          ? `Gemini terminó sin texto (${finishReason}).`
          : "Gemini respondió sin contenido utilizable.",
      );
    }

    return { reply, usage: data.usageMetadata ?? null };
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

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY no está configurada en Railway." },
        { status: 500 },
      );
    }

    const body = (await request.json()) as RequestBody;
    const message = body.message?.trim();

    if (!message) {
      return NextResponse.json({ error: "Escribí un mensaje." }, { status: 400 });
    }

    if (message.length > 12_000) {
      return NextResponse.json(
        { error: "El mensaje es demasiado largo." },
        { status: 413 },
      );
    }

    const history = Array.isArray(body.history)
      ? body.history
          .filter(
            (item): item is ChatMessage =>
              Boolean(
                item &&
                  (item.role === "user" || item.role === "assistant") &&
                  typeof item.content === "string" &&
                  item.content.trim(),
              ),
          )
          .slice(-10)
      : [];

    const contents: Array<Record<string, unknown>> = [
      ...history.map((item) => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content.slice(0, 10_000) }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    const primary = selectedModel(request);
    const fallback =
      process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.1-flash-lite";
    const models = Array.from(new Set([primary, fallback]));
    let lastError = "Gemini no respondió.";

    for (const model of models) {
      try {
        const result = await callModel({ apiKey, model, contents });
        return NextResponse.json({
          reply: result.reply,
          model,
          usage: result.usage,
          assistant: "Trébol — CLOUVA AI",
        });
      } catch (error) {
        lastError =
          error instanceof Error ? error.message : "Gemini no respondió.";
        const status = (error as Error & { status?: number }).status ?? 500;
        if (!isTransient(status, lastError)) {
          return NextResponse.json({ error: lastError }, { status });
        }
      }
    }

    return NextResponse.json(
      {
        error: `Los modelos de Gemini no respondieron. ${lastError}`,
      },
      { status: 503 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudo conectar con Gemini.",
      },
      { status: 500 },
    );
  }
}
