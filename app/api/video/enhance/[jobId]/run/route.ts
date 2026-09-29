import { NextRequest, NextResponse } from "next/server";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";
import { getVideoEnhanceJob, toPublicVideoEnhance, VIDEO_ENHANCE_COLUMNS, type VideoEnhanceRow } from "@/lib/server/video-enhance";
import { runVideoEnhanceJob } from "@/lib/cloud-run-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { jobId } = await context.params;
    const job = await getVideoEnhanceJob(admin, jobId, user.id);
    if (!job) throw new MediaApiError("El trabajo no existe.", 404, "enhance_not_found");
    if (!job.source_storage_path) throw new MediaApiError("Primero subí un video.", 409, "source_required");
    if (!["draft", "failed"].includes(job.status)) throw new MediaApiError("El trabajo ya está en ejecución.", 409, "enhance_locked");

    const now = new Date().toISOString();
    const { data: claimed, error: claimError } = await admin.from("video_enhance_jobs").update({
      status: "queued",
      progress: 1,
      execution_name: null,
      error_code: null,
      error_message: null,
      started_at: job.started_at ?? now,
      completed_at: null,
    }).eq("id", job.id).eq("user_id", user.id).in("status", ["draft", "failed"]).select(VIDEO_ENHANCE_COLUMNS).maybeSingle();
    if (claimError || !claimed) throw new MediaApiError("No se pudo reservar el trabajo.", 409, "enhance_claim_failed");
    try {
      const executionName = await runVideoEnhanceJob(job.id);
      const { data, error } = await admin.from("video_enhance_jobs").update({
        execution_name: executionName,
        status: "processing",
        progress: 3,
      }).eq("id", job.id).eq("user_id", user.id).select(VIDEO_ENHANCE_COLUMNS).single();
      if (error || !data) throw new Error("La GPU arrancó, pero no se pudo registrar la ejecución.");
      return NextResponse.json({ job: toPublicVideoEnhance(data as unknown as VideoEnhanceRow) }, { status: 202 });
    } catch (gpuError) {
      const message = gpuError instanceof Error ? gpuError.message : "No se pudo iniciar la GPU.";
      await admin.from("video_enhance_jobs").update({
        status: "failed",
        error_code: "gpu_start_failed",
        error_message: message.slice(0, 900),
      }).eq("id", job.id).eq("user_id", user.id);
      throw new MediaApiError(message, 503, "gpu_start_failed");
    }
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
