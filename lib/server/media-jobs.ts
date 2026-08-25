import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { downloadGeneratedVideo, getVideoOperation } from "@/lib/gemini-video";
import { uploadGeneratedMediaObject } from "@/lib/gcs-media";

export const MEDIA_JOB_COLUMNS = [
  "id", "user_id", "type", "source_mode", "status", "prompt", "model", "aspect_ratio", "quality",
  "duration_seconds", "reference_storage_path", "reference_url", "output_storage_path", "output_url", "mime_type",
  "operation_id", "provider_metadata", "usage_metadata", "estimated_cost_usd", "actual_cost_usd", "error_code",
  "error_message", "created_at", "started_at", "completed_at", "updated_at",
].join(",");

export type MediaJobRow = {
  id: string;
  user_id: string;
  type: "image" | "video";
  source_mode: "text" | "reference";
  status: string;
  prompt: string;
  model: string;
  aspect_ratio: string;
  quality: string;
  duration_seconds: number | null;
  reference_storage_path: string | null;
  reference_url: string | null;
  output_storage_path: string | null;
  output_url: string | null;
  mime_type: string | null;
  operation_id: string | null;
  provider_metadata: Record<string, unknown> | null;
  usage_metadata: Record<string, unknown> | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

export function toPublicMediaJob(row: MediaJobRow) {
  return {
    id: row.id,
    type: row.type,
    sourceMode: row.source_mode,
    status: row.status,
    prompt: row.prompt,
    model: row.model,
    aspectRatio: row.aspect_ratio,
    quality: row.quality,
    durationSeconds: row.duration_seconds,
    referenceUrl: row.reference_url,
    outputUrl: row.output_url,
    mimeType: row.mime_type,
    estimatedCostUsd: row.estimated_cost_usd,
    actualCostUsd: row.actual_cost_usd,
    error: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

export async function getMediaJob(admin: SupabaseClient, userId: string, jobId: string) {
  const { data, error } = await admin
    .from("media_generation_jobs")
    .select(MEDIA_JOB_COLUMNS)
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("No se pudo recuperar la creación.");
  return data as MediaJobRow | null;
}

function mediaBucket() {
  return process.env.CLOUVA_GENERATED_MEDIA_BUCKET ?? "clouva-generated-media";
}

export async function downloadReferenceImage(referenceUrl: string) {
  const parsed = new URL(referenceUrl);
  const expectedPrefix = `/${mediaBucket()}/`;
  if (parsed.protocol !== "https:" || parsed.hostname !== "storage.googleapis.com" || !parsed.pathname.startsWith(expectedPrefix)) {
    throw new Error("La referencia no pertenece al almacenamiento seguro de CLOUVA.");
  }
  const response = await fetch(parsed, { cache: "no-store", signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error("No se pudo recuperar la imagen de referencia.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 10 * 1024 * 1024) throw new Error("La referencia supera los 10 MB.");
  const metadata = await sharp(bytes).metadata();
  const mimeType = metadata.format === "png" ? "image/png"
    : metadata.format === "webp" ? "image/webp"
      : metadata.format === "jpeg" ? "image/jpeg" : null;
  if (!mimeType || !metadata.width || !metadata.height) throw new Error("La referencia no es una imagen compatible.");
  return { bytes, mimeType, width: metadata.width, height: metadata.height } as const;
}

async function saveCompletedVideo(args: {
  admin: SupabaseClient;
  job: MediaJobRow;
  apiKey: string;
  videoUri: string;
  mimeType: string;
  operationMetadata: Record<string, unknown> | null;
}) {
  const generated = await downloadGeneratedVideo({ apiKey: args.apiKey, videoUri: args.videoUri });
  try {
    const stored = await uploadGeneratedMediaObject({
      bytes: generated.bytes,
      mimeType: generated.mimeType || args.mimeType,
      pathPrefix: `media/${args.job.user_id}/videos`,
    });
    const completedAt = new Date().toISOString();
    const { data, error } = await args.admin
      .from("media_generation_jobs")
      .update({
        status: "completed",
        output_storage_path: stored.objectPath,
        output_url: stored.url,
        mime_type: generated.mimeType || args.mimeType,
        provider_metadata: { operationMetadata: args.operationMetadata },
        actual_cost_usd: args.job.estimated_cost_usd,
        error_code: null,
        error_message: null,
        completed_at: completedAt,
      })
      .eq("id", args.job.id)
      .eq("user_id", args.job.user_id)
      .select(MEDIA_JOB_COLUMNS)
      .single();
    if (error || !data) throw new Error("No se pudo registrar el video terminado.");
    return data as unknown as MediaJobRow;
  } catch (error) {
    await args.admin
      .from("media_generation_jobs")
      .update({
        status: "storage_failed",
        error_code: "storage_failed",
        error_message: "El video se generó, pero no pudo guardarse. Podés reintentar el guardado sin volver a generarlo.",
      })
      .eq("id", args.job.id)
      .eq("user_id", args.job.user_id);
    throw error;
  }
}

export async function syncVideoJob(admin: SupabaseClient, job: MediaJobRow, apiKey: string) {
  if (job.type !== "video" || !["generating", "processing"].includes(job.status) || !job.operation_id) return job;
  try {
    const operation = await getVideoOperation({ apiKey, operationName: job.operation_id });
    if (!operation.done) {
      if (job.status !== "processing") {
        await admin.from("media_generation_jobs").update({ status: "processing" }).eq("id", job.id).eq("user_id", job.user_id);
        return { ...job, status: "processing", updated_at: new Date().toISOString() };
      }
      return job;
    }
    if (!operation.videoUri) throw new Error("Gemini terminó sin devolver el video.");
    return await saveCompletedVideo({
      admin,
      job,
      apiKey,
      videoUri: operation.videoUri,
      mimeType: operation.mimeType,
      operationMetadata: operation.metadata,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "La generación de video falló.";
    if (/guardarse|almacen|registrar el video/i.test(message)) throw error;
    await admin
      .from("media_generation_jobs")
      .update({ status: "failed", error_code: "provider_failed", error_message: "El video no pudo generarse." })
      .eq("id", job.id)
      .eq("user_id", job.user_id);
    throw error;
  }
}

export async function retryVideoStorage(admin: SupabaseClient, job: MediaJobRow, apiKey: string) {
  if (job.type !== "video" || job.status !== "storage_failed" || !job.operation_id) {
    throw new Error("Este trabajo no tiene un guardado de video pendiente.");
  }
  const operation = await getVideoOperation({ apiKey, operationName: job.operation_id });
  if (!operation.done || !operation.videoUri) throw new Error("El resultado del video todavía no está disponible.");
  return saveCompletedVideo({
    admin,
    job,
    apiKey,
    videoUri: operation.videoUri,
    mimeType: operation.mimeType,
    operationMetadata: operation.metadata,
  });
}
