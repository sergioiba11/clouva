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

const CLOUVA_MODELS: Record<
  string,
  {
    order: number;
    recommendedFor: string;
    tier: "principal" | "respaldo";
  }
> = {
  "gemini-3.5-flash": {
    order: 0,
    tier: "principal",
    recommendedFor: "Arquitectura, código, investigación y tareas complejas",
  },
  "gemini-3.1-flash-lite": {
    order: 1,
    tier: "respaldo",
    recommendedFor: "Chat rápido, tareas livianas y menor costo",
  },
};

function modelId(model: GeminiModel) {
  return (model.name ?? "").replace(/^models\//, "");
}

function isAllowed(model: GeminiModel) {
  const id = modelId(model);
  const methods = model.supportedGenerationMethods ?? [];
  return id in CLOUVA_MODELS && methods.includes("generateContent");
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

    const available = (payload.models ?? [])
      .filter(isAllowed)
      .map((model) => {
        const id = modelId(model);
        const config = CLOUVA_MODELS[id];
        return {
          id,
          name: model.displayName ?? model.name ?? "Gemini",
          description: model.description ?? "Modelo compatible con CLOUVA AI.",
          inputTokenLimit: model.inputTokenLimit ?? null,
          outputTokenLimit: model.outputTokenLimit ?? null,
          recommendedFor: config.recommendedFor,
          tier: config.tier,
          order: config.order,
        };
      })
      .sort((a, b) => a.order - b.order)
      .map(({ order: _order, ...model }) => model);

    const configuredDefault = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
    const defaultModel = available.some((model) => model.id === configuredDefault)
      ? configuredDefault
      : available[0]?.id ?? configuredDefault;

    return NextResponse.json({
      ok: true,
      models: available,
      defaultModel,
      fallbackModel:
        process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.1-flash-lite",
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
