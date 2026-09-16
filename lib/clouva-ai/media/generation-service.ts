import "server-only";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compilePromptWithContext } from "@/lib/clouva-ai/media/context-service";
import { estimateConfiguredVideoCost, getClouAIMediaConfig, type ClouAIVideoTier } from "@/lib/clouva-ai/media/config";
import { generateGoogleImage } from "@/lib/clouva-ai/media/providers/google/image";
import { getGoogleVideoOperation, startGoogleVideoGeneration } from "@/lib/clouva-ai/media/providers/google/video";
import { uploadGeneratedMediaObject } from "@/lib/gcs-media";

export const CLOUAI_MEDIA_JOB_COLUMNS = [
  "id","user_id","type","source_mode","status","prompt","enriched_prompt","provider","model","aspect_ratio","quality","resolution","duration_seconds","audio_enabled","quantity","context_ids","active_reference_ids","reference_storage_path","reference_url","output_storage_path","output_url","mime_type","operation_id","provider_metadata","usage_metadata","settings_json","estimated_cost_usd","actual_cost_usd","error_code","error_message","conversation_id","created_at","started_at","completed_at","updated_at",
].join(",");

export type ClouAIMediaJobRow = {
  id: string; user_id: string; type: "image" | "video"; source_mode: string; status: string; prompt: string;
  enriched_prompt: string | null; provider: string; model: string; aspect_ratio: string; quality: string; resolution: string | null;
  duration_seconds: number | null; audio_enabled: boolean; quantity: number; context_ids: string[]; active_reference_ids: string[];
  reference_storage_path: string | null; reference_url: string | null; output_storage_path: string | null; output_url: string | null;
  mime_type: string | null; operation_id: string | null; provider_metadata: Record<string, unknown>; usage_metadata: Record<string, unknown>;
  settings_json: Record<string, unknown>; estimated_cost_usd: number | null; actual_cost_usd: number | null; error_code: string | null;
  error_message: string | null; conversation_id: string | null; created_at: string; started_at: string | null; completed_at: string | null; updated_at: string;
};

export function publicClouAIMediaJob(row: ClouAIMediaJobRow) {
  return {
    id: row.id, type: row.type, status: row.status, prompt: row.prompt, enrichedPrompt: row.enriched_prompt,
    provider: row.provider, model: row.model, aspectRatio: row.aspect_ratio, quality: row.quality, resolution: row.resolution,
    durationSeconds: row.duration_seconds, audioEnabled: row.audio_enabled, quantity: row.quantity,
    contextIds: row.context_ids ?? [], activeReferenceIds: row.active_reference_ids ?? [], outputUrl: row.output_url,
    mimeType: row.mime_type, estimatedCostUsd: row.estimated_cost_usd, actualCostUsd: row.actual_cost_usd,
    error: row.error_message, conversationId: row.conversation_id, createdAt: row.created_at, startedAt: row.started_at,
    completedAt: row.completed_at, updatedAt: row.updated_at,
  };
}

async function updateJob(admin: SupabaseClient, userId: string, id: string, updates: Record<string, unknown>) {
  const { data, error } = await admin.from("media_generation_jobs").update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id).eq("user_id", userId).select(CLOUAI_MEDIA_JOB_COLUMNS).single();
  if (error || !data) throw new Error("No se pudo actualizar la generación.");
  return data as unknown as ClouAIMediaJobRow;
}

async function createJob(admin: SupabaseClient, args: {
  userId: string; idempotencyKey: string; type: "image" | "video"; prompt: string; contextIds: string[]; model: string;
  aspectRatio: string; quality: string; resolution: string; durationSeconds: number | null; audioEnabled: boolean; quantity: number;
  conversationId?: string | null; estimatedCostUsd?: number | null; settings?: Record<string, unknown>;
}) {
  const { data: existing } = await admin.from("media_generation_jobs").select(CLOUAI_MEDIA_JOB_COLUMNS)
    .eq("user_id", args.userId).eq("idempotency_key", args.idempotencyKey).maybeSingle();
  if (existing) return { job: existing as unknown as ClouAIMediaJobRow, reused: true };
  const now = new Date().toISOString();
  const { data, error } = await admin.from("media_generation_jobs").insert({
    user_id: args.userId,
    idempotency_key: args.idempotencyKey,
    type: args.type,
    source_mode: args.contextIds.length ? "reference" : "text",
    status: "preparing_context",
    prompt: args.prompt,
    provider: "google-cloud",
    model: args.model,
    aspect_ratio: args.aspectRatio,
    quality: args.quality,
    resolution: args.resolution,
    duration_seconds: args.durationSeconds,
    audio_enabled: args.audioEnabled,
    quantity: args.quantity,
    context_ids: args.contextIds,
    active_reference_ids: [],
    settings_json: args.settings ?? {},
    estimated_cost_usd: args.estimatedCostUsd ?? null,
    conversation_id: args.conversationId ?? null,
    started_at: now,
  }).select(CLOUAI_MEDIA_JOB_COLUMNS).single();
  if (error || !data) throw new Error("No se pudo registrar la generación.");
  return { job: data as unknown as ClouAIMediaJobRow, reused: false };
}

async function failJob(admin: SupabaseClient, userId: string, id: string, error: unknown) {
  const message = error instanceof Error ? error.message : "La generación falló.";
  await admin.from("media_generation_jobs").update({
    status: "failed", error_code: "provider_failed", error_message: message.slice(0, 500), updated_at: new Date().toISOString(),
  }).eq("id", id).eq("user_id", userId);
}

export async function startImageJob(admin: SupabaseClient, args: {
  userId: string; idempotencyKey: string; prompt: string; contextIds: string[]; aspectRatio: string;
  imageSize: "1K" | "2K" | "4K"; quantity: number; conversationId?: string | null; seed?: number | null;
}) {
  const mediaConfig = getClouAIMediaConfig();
  const created = await createJob(admin, {
    userId: args.userId, idempotencyKey: args.idempotencyKey, type: "image", prompt: args.prompt, contextIds: args.contextIds,
    model: mediaConfig.models.image, aspectRatio: args.aspectRatio, quality: args.imageSize, resolution: args.imageSize,
    durationSeconds: null, audioEnabled: false, quantity: args.quantity, conversationId: args.conversationId, settings: { seed: args.seed ?? null },
  });
  if (created.reused) return created.job;
  const jobId = created.job.id;
  try {
    const { bundle, enrichedPrompt } = await compilePromptWithContext(admin, args.userId, { mode: "image", prompt: args.prompt, contextIds: args.contextIds });
    const references = bundle.activeReferences.map((asset) => ({ id: asset.id, storagePath: asset.storagePath, mimeType: asset.mimeType }));
    await updateJob(admin, args.userId, jobId, {
      status: "generating", enriched_prompt: enrichedPrompt, active_reference_ids: references.map((reference) => reference.id),
    });

    const outputs = [];
    let usageMetadata: unknown = null;
    for (let index = 0; index < args.quantity; index += 1) {
      const generated = await generateGoogleImage({
        prompt: enrichedPrompt, references, aspectRatio: args.aspectRatio, imageSize: args.imageSize,
        seed: typeof args.seed === "number" ? args.seed + index : null,
      });
      usageMetadata = generated.usageMetadata;
      const stored = await uploadGeneratedMediaObject({
        bytes: generated.bytes, mimeType: generated.mimeType, pathPrefix: `clouai/generations/${args.userId}/${jobId}/images`,
      });
      const metadata = await sharp(generated.bytes).metadata();
      outputs.push({
        generation_id: jobId, user_id: args.userId, output_type: "image", storage_path: stored.objectPath,
        public_url: stored.url, mime_type: generated.mimeType, width: metadata.width ?? null, height: metadata.height ?? null,
        metadata_json: { index, providerText: generated.text },
      });
    }
    const { error: outputError } = await admin.from("clouai_generation_outputs").insert(outputs);
    if (outputError) throw new Error("La imagen se generó, pero no se pudieron registrar sus outputs.");
    const first = outputs[0];
    return await updateJob(admin, args.userId, jobId, {
      status: "completed", output_storage_path: first.storage_path, output_url: first.public_url, mime_type: first.mime_type,
      usage_metadata: usageMetadata ?? {}, actual_cost_usd: null, completed_at: new Date().toISOString(), error_code: null, error_message: null,
    });
  } catch (error) {
    await failJob(admin, args.userId, jobId, error);
    throw error;
  }
}

export async function startVideoJob(admin: SupabaseClient, args: {
  userId: string; idempotencyKey: string; prompt: string; contextIds: string[]; aspectRatio: "16:9" | "9:16";
  durationSeconds: 4 | 6 | 8; resolution: "720p" | "1080p"; audioEnabled: boolean; quantity: number;
  tier: ClouAIVideoTier; conversationId?: string | null; negativePrompt?: string | null; seed?: number | null;
  confirmedCostUsd?: number | null;
}) {
  const configuredEstimate = estimateConfiguredVideoCost(args.tier, args.durationSeconds, args.quantity);
  if (configuredEstimate != null && (args.confirmedCostUsd == null || Math.abs(args.confirmedCostUsd - configuredEstimate) > 0.001)) {
    throw new Error("El costo configurado cambió. Revisá la estimación y confirmá nuevamente.");
  }
  const model = getClouAIMediaConfig().models.video[args.tier];
  const created = await createJob(admin, {
    userId: args.userId, idempotencyKey: args.idempotencyKey, type: "video", prompt: args.prompt, contextIds: args.contextIds,
    model, aspectRatio: args.aspectRatio, quality: args.tier, resolution: args.resolution, durationSeconds: args.durationSeconds,
    audioEnabled: args.audioEnabled, quantity: args.quantity, conversationId: args.conversationId, estimatedCostUsd: configuredEstimate,
    settings: { negativePrompt: args.negativePrompt ?? null, seed: args.seed ?? null },
  });
  if (created.reused) return created.job;
  const jobId = created.job.id;
  try {
    const { bundle, enrichedPrompt } = await compilePromptWithContext(admin, args.userId, { mode: "video", prompt: args.prompt, contextIds: args.contextIds });
    const references = bundle.activeReferences.map((asset) => ({ id: asset.id, storagePath: asset.storagePath, mimeType: asset.mimeType }));
    const operation = await startGoogleVideoGeneration({
      prompt: enrichedPrompt, references, aspectRatio: args.aspectRatio, durationSeconds: args.durationSeconds,
      resolution: args.resolution, audioEnabled: args.audioEnabled, quantity: args.quantity, tier: args.tier,
      userId: args.userId, jobId, negativePrompt: args.negativePrompt, seed: args.seed,
    });
    return await updateJob(admin, args.userId, jobId, {
      status: "submitted", enriched_prompt: enrichedPrompt, model: operation.model,
      active_reference_ids: operation.activeReferenceIds, operation_id: operation.operationName,
      provider_metadata: { operationMetadata: operation.metadata, requestedTier: args.tier, effectiveTier: operation.tier },
    });
  } catch (error) {
    await failJob(admin, args.userId, jobId, error);
    throw error;
  }
}

export async function syncVideoJob(admin: SupabaseClient, userId: string, job: ClouAIMediaJobRow) {
  if (job.type !== "video" || !["submitted", "generating", "processing"].includes(job.status) || !job.operation_id) return job;
  try {
    const operation = await getGoogleVideoOperation(job.operation_id);
    if (!operation.done) {
      return job.status === "processing" ? job : await updateJob(admin, userId, job.id, { status: "processing", provider_metadata: { ...(job.provider_metadata ?? {}), operationMetadata: operation.metadata } });
    }
    if (!operation.videos.length) throw new Error("Vertex AI terminó sin devolver videos.");
    const rows = operation.videos.map((video, index) => ({
      generation_id: job.id, user_id: userId, output_type: "video", storage_path: video.storagePath ?? video.uri,
      public_url: video.publicUrl, mime_type: video.mimeType, duration_seconds: job.duration_seconds,
      metadata_json: { index, gcsUri: video.uri },
    }));
    await admin.from("clouai_generation_outputs").delete().eq("generation_id", job.id).eq("user_id", userId);
    const { error } = await admin.from("clouai_generation_outputs").insert(rows);
    if (error) throw new Error("El video terminó, pero no se pudieron registrar sus outputs.");
    const first = rows[0];
    return await updateJob(admin, userId, job.id, {
      status: "completed", output_storage_path: first.storage_path, output_url: first.public_url, mime_type: first.mime_type,
      actual_cost_usd: job.estimated_cost_usd, completed_at: new Date().toISOString(), error_code: null, error_message: null,
      provider_metadata: { ...(job.provider_metadata ?? {}), operationMetadata: operation.metadata },
    });
  } catch (error) {
    await failJob(admin, userId, job.id, error);
    throw error;
  }
}

export async function getGeneration(admin: SupabaseClient, userId: string, id: string) {
  const { data, error } = await admin.from("media_generation_jobs").select(CLOUAI_MEDIA_JOB_COLUMNS).eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw new Error("No se pudo recuperar la generación.");
  return data as unknown as ClouAIMediaJobRow | null;
}
