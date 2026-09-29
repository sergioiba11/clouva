import { NextRequest, NextResponse } from "next/server";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";
import {
  listVideoEnhanceJobs,
  toPublicVideoEnhance,
  VIDEO_ENHANCE_COLUMNS,
  type VideoEnhanceRow,
} from "@/lib/server/video-enhance";
import { getVideoEnhanceRuntimeStatus } from "@/lib/cloud-run-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODELS = new Set([
  "ltxv-13b-0.9.8-distilled",
  "ltxv-2b-0.9.8-distilled",
]);

function bool(value: unknown, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

export async function GET(request: NextRequest) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const limit = Number(request.nextUrl.searchParams.get("limit") || 20);
    const [jobs, runtimeStatus] = await Promise.all([
      listVideoEnhanceJobs(admin, user.id, limit),
      getVideoEnhanceRuntimeStatus().catch(() => ({
        ready: false,
        reason: "runtime_status_unavailable",
        location: process.env.CLOUVA_VIDEO_ENHANCE_REGION || process.env.CLOUVA_GCP_REGION || "us-central1",
      })),
    ]);
    return NextResponse.json({
      items: jobs.map(toPublicVideoEnhance),
      runtime: runtimeStatus,
    });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const title = String(body.title || "AI Enhance").trim().slice(0, 160);
    const prompt = String(body.prompt || "").trim().slice(0, 4000);
    if (!prompt) throw new MediaApiError("Describí cómo querés transformar el video.", 400, "prompt_required");

    const model = String(body.model || "ltxv-13b-0.9.8-distilled");
    if (!MODELS.has(model)) throw new MediaApiError("Modelo LTX inválido.", 400, "invalid_model");
    const mode = ["faithful", "balanced", "reimagine"].includes(String(body.mode)) ? String(body.mode) : "balanced";
    const strength = Math.max(0, Math.min(1, Number(body.transformStrength ?? 0.45)));
    const outputResolution = body.outputResolution === "480p" ? "480p" : "720p";
    const outputFps = [24, 25, 30].includes(Number(body.outputFps)) ? Number(body.outputFps) : 24;
    const seed = Number.isFinite(Number(body.seed)) ? Math.trunc(Number(body.seed)) : 171198;
    const trimStart = Math.max(0, Number(body.trimStartSeconds ?? 0));
    const trimDurationRaw = Number(body.trimDurationSeconds);
    const trimDuration = Number.isFinite(trimDurationRaw) && trimDurationRaw > 0 ? trimDurationRaw : null;

    const { data, error } = await admin.from("video_enhance_jobs").insert({
      user_id: user.id,
      title: title || "AI Enhance",
      prompt,
      negative_prompt: String(body.negativePrompt || "blurry, jittery, distorted, inconsistent motion, text, watermark").trim().slice(0, 2000),
      model,
      mode,
      transform_strength: strength,
      preserve_motion: bool(body.preserveMotion),
      preserve_camera: bool(body.preserveCamera),
      preserve_subject: bool(body.preserveSubject),
      preserve_audio: bool(body.preserveAudio),
      output_resolution: outputResolution,
      output_fps: outputFps,
      seed,
      trim_start_seconds: trimStart,
      trim_duration_seconds: trimDuration,
    }).select(VIDEO_ENHANCE_COLUMNS).single();

    if (error || !data) throw new MediaApiError("No se pudo crear el trabajo Video AI.", 500, "enhance_create_failed");
    return NextResponse.json({ job: toPublicVideoEnhance(data as unknown as VideoEnhanceRow) }, { status: 201 });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
