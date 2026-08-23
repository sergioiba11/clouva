import { NextRequest, NextResponse } from "next/server";
import { getStoredGeneratedImage } from "@/lib/gemini-image";
import { uploadGeneratedMediaObject } from "@/lib/gcs-media";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";
import {
  getMediaJob,
  MEDIA_JOB_COLUMNS,
  retryVideoStorage,
  toPublicMediaJob,
  type MediaJobRow,
} from "@/lib/server/media-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { id } = await context.params;
    const job = await getMediaJob(admin, user.id, id);
    if (!job) throw new MediaApiError("La creación no existe.", 404, "job_not_found");
    if (job.status !== "storage_failed") {
      throw new MediaApiError("Esta creación no tiene un guardado pendiente.", 409, "storage_retry_not_available");
    }
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new MediaApiError("GEMINI_API_KEY no está configurada.", 500, "missing_api_key");

    if (job.type === "video") {
      const completed = await retryVideoStorage(admin, job, apiKey);
      return NextResponse.json({ job: toPublicMediaJob(completed) });
    }

    if (!job.operation_id) {
      throw new MediaApiError("El resultado de imagen ya no está disponible para reintentar.", 409, "provider_result_unavailable");
    }
    const generated = await getStoredGeneratedImage({ apiKey, interactionId: job.operation_id });
    const stored = await uploadGeneratedMediaObject({
      bytes: generated.bytes,
      mimeType: generated.mimeType,
      pathPrefix: `media/${user.id}/images`,
    });
    const { data, error } = await admin
      .from("media_generation_jobs")
      .update({
        status: "completed",
        output_storage_path: stored.objectPath,
        output_url: stored.url,
        mime_type: generated.mimeType,
        error_code: null,
        error_message: null,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .eq("user_id", user.id)
      .select(MEDIA_JOB_COLUMNS)
      .single();
    if (error || !data) throw new MediaApiError("No se pudo registrar el guardado.", 500, "storage_update_failed");
    return NextResponse.json({ job: toPublicMediaJob(data as unknown as MediaJobRow) });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
