import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const SYSTEM_INSTRUCTION = `
Sos CLOUVA AI, el asistente principal del proyecto CLOUVA. Respondé en español rioplatense,
con claridad, de forma práctica y sin inventar datos. Ayudá a pensar producto, diseño,
avatares 3D, prendas, accesorios, escenas, música, comunidad, prompts y desarrollo.
En este modo sos un chat estable: no afirmes que leíste GitHub ni que modificaste archivos.
Cuando falte información esencial, pedí solamente el dato mínimo necesario.
`.trim();

type ChatMessage = { role: "user" | "assistant"; content: string };
type RequestBody = { message?: string; history?: ChatMessage[] };

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
    value.includes("unavailable")
  );
}

async function callModel(args: {
  apiKey: string;
  model: string;
  contents: Array<Record<string, unknown>>;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

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
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents: args.contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
          },
        }),
        signal: controller.signal,
        cache: "no-store",
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

    const reply = data?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part.text ?? "")
      .join("")
      .trim();

    if (!reply) throw new Error("Gemini respondió sin contenido utilizable.");
    return reply as string;
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
    if (message.length > 8_000) {
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
          .slice(-8)
      : [];

    const contents: Array<Record<string, unknown>> = [
      ...history.map((item) => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content.slice(0, 8_000) }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    const primary = selectedModel(request);
    const fallback = process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.1-flash-lite";
    const models = Array.from(new Set([primary, fallback]));
    let lastError = "Gemini no respondió.";

    for (const model of models) {
      try {
        const reply = await callModel({ apiKey, model, contents });
        return NextResponse.json({ reply, model });
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Gemini no respondió.";
        const status = (error as Error & { status?: number }).status ?? 500;
        if (!isTransient(status, lastError)) {
          return NextResponse.json({ error: lastError }, { status });
        }
      }
    }

    return NextResponse.json(
      { error: `Los modelos de Gemini no respondieron. ${lastError}` },
      { status: 503 },
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      {
        error: timedOut
          ? "Gemini tardó demasiado en responder. Probá de nuevo."
          : error instanceof Error
            ? error.message
            : "No se pudo conectar con Gemini.",
      },
      { status: timedOut ? 504 : 500 },
    );
  }
}
