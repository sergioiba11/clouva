import { NextRequest, NextResponse } from "next/server";
import { IMAGE_QUALITY_CONFIG, MEDIA_PRICING_VERSION, VIDEO_QUALITY_CONFIG } from "@/lib/media-generation-config";
import { publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GeminiModel = { name?: string; supportedGenerationMethods?: string[] };

export async function GET(request: NextRequest) {
  try {
    await requireMediaAdmin(request);

    const geminiApiKey = process.env.GEMINI_API_KEY;
    const runwayApiKey = process.env.RUNWAY_API_KEY;
    const availableImageModels = new Set<string>();
    let imageWarning: string | null = null;

    if (geminiApiKey) {
      try {
        const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
          headers: { "x-goog-api-key": geminiApiKey },
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        });
        const payload = await response.json().catch(() => ({})) as { models?: GeminiModel[]; error?: { message?: string } };
        if (response.ok) {
          for (const model of payload.models ?? []) {
            const name = model.name?.replace(/^models\//, "");
            if (name) availableImageModels.add(name);
          }
        } else {
          imageWarning = payload.error?.message ?? "No se pudieron comprobar los modelos de imagen de Gemini.";
        }
      } catch {
        imageWarning = "No se pudieron comprobar los modelos de imagen de Gemini.";
      }
    } else {
      imageWarning = "GEMINI_API_KEY no está configurada para generación de imágenes.";
    }

    return NextResponse.json({
      pricingVersion: MEDIA_PRICING_VERSION,
      imageWarning,
      image: Object.entries(IMAGE_QUALITY_CONFIG).map(([quality, config]) => ({
        quality,
        label: config.label,
        model: config.model,
        imageSize: config.imageSize,
        available: availableImageModels.has(config.model),
      })),
      video: Object.entries(VIDEO_QUALITY_CONFIG).map(([quality, config]) => ({
        quality,
        label: config.label,
        model: config.model,
        provider: "runway",
        resolution: config.resolution,
        creditsPerSecond: config.creditsPerSecond,
        pricePerSecondUsd: config.pricePerSecondUsd,
        available: Boolean(runwayApiKey),
      })),
    });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
