import { NextRequest, NextResponse } from "next/server";
import { IMAGE_QUALITY_CONFIG, MEDIA_PRICING_VERSION, VIDEO_QUALITY_CONFIG } from "@/lib/media-generation-config";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GeminiModel = { name?: string; supportedGenerationMethods?: string[] };

export async function GET(request: NextRequest) {
  try {
    await requireMediaAdmin(request);
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new MediaApiError("GEMINI_API_KEY no está configurada.", 500, "missing_api_key");
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
      headers: { "x-goog-api-key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({})) as { models?: GeminiModel[]; error?: { message?: string } };
    if (!response.ok) throw new MediaApiError(payload.error?.message ?? "No se pudieron comprobar los modelos.", response.status, "model_check_failed");
    const available = new Map((payload.models ?? []).map((model) => [model.name?.replace(/^models\//, ""), model]));
    return NextResponse.json({
      pricingVersion: MEDIA_PRICING_VERSION,
      image: Object.entries(IMAGE_QUALITY_CONFIG).map(([quality, config]) => ({
        quality,
        label: config.label,
        model: config.model,
        imageSize: config.imageSize,
        available: available.has(config.model),
      })),
      video: Object.entries(VIDEO_QUALITY_CONFIG).map(([quality, config]) => ({
        quality,
        label: config.label,
        model: config.model,
        resolution: config.resolution,
        pricePerSecondUsd: config.pricePerSecondUsd,
        available: available.has(config.model),
      })),
    });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
