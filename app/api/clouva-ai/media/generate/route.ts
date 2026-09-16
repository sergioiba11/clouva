import { NextRequest, NextResponse } from "next/server";
import { startImageJob, startVideoJob, publicClouAIMediaJob } from "@/lib/clouva-ai/media/generation-service";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const IMAGE_ASPECTS = new Set(["1:1", "4:3", "3:4", "16:9", "9:16", "21:9"]);
const VIDEO_ASPECTS = new Set(["16:9", "9:16"]);
const IMAGE_SIZES = new Set(["1K", "2K", "4K"]);
const VIDEO_RESOLUTIONS = new Set(["720p", "1080p"]);
const VIDEO_TIERS = new Set(["lite", "fast", "cinematic"]);

function promptValue(value: unknown) {
  const prompt = typeof value === "string" ? value.trim() : "";
  if (!prompt) throw new MediaApiError("Describí lo que querés crear.", 400, "prompt_required");
  if (prompt.length > 4000) throw new MediaApiError("El prompt supera los 4.000 caracteres.", 413, "prompt_too_long");
  return prompt;
}
function idempotencyValue(value: unknown) {
  const key = typeof value === "string" ? value : "";
  if (!/^[a-zA-Z0-9_-]{16,96}$/.test(key)) throw new MediaApiError("Clave de generación inválida.", 400, "invalid_idempotency_key");
  return key;
}
function contextIdsValue(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && /^[0-9a-f-]{36}$/i.test(item)))].slice(0, 12);
}
function intBetween(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export async function POST(request: NextRequest) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const type = body.type === "video" ? "video" : body.type === "image" ? "image" : null;
    if (!type) throw new MediaApiError("Elegí Imagen o Video.", 400, "invalid_media_type");
    const prompt = promptValue(body.prompt);
    const idempotencyKey = idempotencyValue(body.idempotencyKey);
    const contextIds = contextIdsValue(body.contextIds);
    const quantity = intBetween(body.quantity, 1, 1, 4);
    const conversationId = typeof body.conversationId === "string" && /^[0-9a-f-]{36}$/i.test(body.conversationId) ? body.conversationId : null;
    const seed = Number.isInteger(body.seed) ? Number(body.seed) : null;

    const { count: activeCount, error: activeError } = await admin.from("media_generation_jobs").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).in("status", ["queued", "preparing_context", "submitted", "generating", "processing", "saving"]);
    if (activeError) throw new MediaApiError("No se pudo comprobar el estado de generaciones activas.", 500, "active_check_failed");
    if ((activeCount ?? 0) >= 3) throw new MediaApiError("Ya hay tres generaciones en curso. Esperá a que termine una.", 409, "active_limit");

    if (type === "image") {
      const aspectRatio = typeof body.aspectRatio === "string" && IMAGE_ASPECTS.has(body.aspectRatio) ? body.aspectRatio : "1:1";
      const imageSize = typeof body.imageSize === "string" && IMAGE_SIZES.has(body.imageSize) ? body.imageSize as "1K" | "2K" | "4K" : "2K";
      const job = await startImageJob(admin, {
        userId: user.id, idempotencyKey, prompt, contextIds, aspectRatio, imageSize, quantity, conversationId, seed,
      });
      return NextResponse.json({ job: publicClouAIMediaJob(job) }, { status: job.status === "completed" ? 200 : 202 });
    }

    const aspectRatio = typeof body.aspectRatio === "string" && VIDEO_ASPECTS.has(body.aspectRatio) ? body.aspectRatio as "16:9" | "9:16" : "16:9";
    const durationSeconds = [4, 6, 8].includes(Number(body.durationSeconds)) ? Number(body.durationSeconds) as 4 | 6 | 8 : 8;
    const resolution = typeof body.resolution === "string" && VIDEO_RESOLUTIONS.has(body.resolution) ? body.resolution as "720p" | "1080p" : "720p";
    const tier = typeof body.videoTier === "string" && VIDEO_TIERS.has(body.videoTier) ? body.videoTier as "lite" | "fast" | "cinematic" : "fast";
    const job = await startVideoJob(admin, {
      userId: user.id,
      idempotencyKey,
      prompt,
      contextIds,
      aspectRatio,
      durationSeconds,
      resolution,
      audioEnabled: body.audioEnabled === true,
      quantity,
      tier,
      conversationId,
      negativePrompt: typeof body.negativePrompt === "string" ? body.negativePrompt.trim().slice(0, 2000) : null,
      seed,
      confirmedCostUsd: typeof body.confirmedCostUsd === "number" ? body.confirmedCostUsd : null,
    });
    return NextResponse.json({ job: publicClouAIMediaJob(job) }, { status: 202 });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
