import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const revalidate = 300;

type GeminiModel = {
  name?: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
  inputTokenLimit?: number;
  outputTokenLimit?: number;
};

function isChatCompatible(model: GeminiModel) {
  const id = (model.name ?? "").replace(/^models\//, "");
  const methods = model.supportedGenerationMethods ?? [];

  return (
    id.startsWith("gemini-") &&
    methods.includes("generateContent") &&
    !id.includes("embedding") &&
    !id.includes("image") &&
    !id.includes("tts") &&
    !id.includes("live") &&
    !id.includes("robotics")
  );
}

export async function GET() {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Falta GEMINI_API_KEY en Railway." },
        { status: 500 },
      );
    }

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
      {
        headers: { "x-goog-api-key": apiKey },
        cache: "no-store",
      },
    );

    const payload = (await response.json().catch(() => ({}))) as {
      models?: GeminiModel[];
      error?: { message?: string };
    };

    if (!response.ok) {
      throw new Error(
        payload.error?.message ?? `Gemini respondió HTTP ${response.status}`,
      );
    }

    const models = (payload.models ?? [])
      .filter(isChatCompatible)
      .map((model) => ({
        id: (model.name ?? "").replace(/^models\//, ""),
        name: model.displayName ?? model.name ?? "Gemini",
        description: model.description ?? "Modelo compatible con chat.",
        inputTokenLimit: model.inputTokenLimit ?? null,
        outputTokenLimit: model.outputTokenLimit ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      ok: true,
      models,
      defaultModel: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No se pudieron cargar los modelos Gemini.",
      },
      { status: 500 },
    );
  }
}
