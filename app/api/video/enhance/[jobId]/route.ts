import { NextRequest, NextResponse } from "next/server";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";
import {
  getVideoEnhanceJob,
  toPublicVideoEnhance,
  VIDEO_ENHANCE_COLUMNS,
  type VideoEnhanceRow,
} from "@/lib/server/video-enhance";
import { getRunpodVideoStatus } from "@/lib/runpod-video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE = new Set(["queued", "processing"]);
const FAILED = new Set(["FAILED", "CANCELLED", "TIMED_OUT"]);

export async function GET(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { jobId } = await context.params;
    let job = await getVideoEnhanceJob(admin, jobId, user.id);
    if (!job) throw new MediaApiError("El trabajo no existe.", 404, "enhance_not_found");

    if (ACTIVE.has(job.status) && job.execution_name?.startsWith("runpod:")) {
      try {
        const remote = await getRunpodVideoStatus(job.execution_name);
        if (remote?.status === "COMPLETED") {
          const output = remote.output ?? {};
          if (!output.output_storage_path || !output.thumbnail_storage_path || !output.output_url || !output.thumbnail_url) {
            throw new Error("Runpod terminó sin devolver los archivos de salida.");
          }
          const { data, error } = await admin.from("video_enhance_jobs").update({
            status: "completed",
            progress: 100,
            output_storage_path: output.output_storage_path,
            output_url: output.output_url,
            thumbnail_storage_path: output.thumbnail_storage_path,
            thumbnail_url: output.thumbnail_url,
            gpu_seconds: output.gpu_seconds ?? (remote.executionTime ? Number(remote.executionTime) / 1000 : null),
            error_code: null,
            error_message: null,
            completed_at: new Date().toISOString(),
          }).eq("id", job.id).eq("user_id", user.id).select(VIDEO_ENHANCE_COLUMNS).single();
          if (!error && data) job = data as unknown as VideoEnhanceRow;
        } else if (remote?.status && FAILED.has(remote.status)) {
          const message = remote.output?.error || remote.error || `Runpod finalizó con estado ${remote.status}.`;
          const { data, error } = await admin.from("video_enhance_jobs").update({
            status: "failed",
            error_code: `runpod_${remote.status.toLowerCase()}`,
            error_message: String(message).slice(0, 900),
            completed_at: new Date().toISOString(),
          }).eq("id", job.id).eq("user_id", user.id).select(VIDEO_ENHANCE_COLUMNS).single();
          if (!error && data) job = data as unknown as VideoEnhanceRow;
        } else if (remote?.status === "IN_PROGRESS" && job.status !== "processing") {
          const { data, error } = await admin.from("video_enhance_jobs").update({
            status: "processing",
            progress: Math.max(5, job.progress),
          }).eq("id", job.id).eq("user_id", user.id).select(VIDEO_ENHANCE_COLUMNS).single();
          if (!error && data) job = data as unknown as VideoEnhanceRow;
        }
      } catch (remoteError) {
        console.warn("[video-enhance] Runpod status sync failed", remoteError);
      }
    }

    return NextResponse.json({ job: toPublicVideoEnhance(job) });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
