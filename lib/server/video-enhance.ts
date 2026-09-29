import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export const VIDEO_ENHANCE_COLUMNS = [
  "id", "user_id", "title", "source_storage_path", "source_url", "source_filename",
  "source_size_bytes", "prompt", "negative_prompt", "model", "mode", "transform_strength",
  "preserve_motion", "preserve_camera", "preserve_subject", "preserve_audio",
  "output_resolution", "output_fps", "seed", "trim_start_seconds", "trim_duration_seconds",
  "status", "progress", "execution_name", "output_storage_path", "output_url",
  "thumbnail_storage_path", "thumbnail_url", "gpu_seconds", "error_code", "error_message",
  "started_at", "completed_at", "created_at", "updated_at",
].join(",");

export type VideoEnhanceRow = {
  id: string;
  user_id: string;
  title: string;
  source_storage_path: string | null;
  source_url: string | null;
  source_filename: string | null;
  source_size_bytes: number | null;
  prompt: string;
  negative_prompt: string;
  model: string;
  mode: "faithful" | "balanced" | "reimagine";
  transform_strength: number;
  preserve_motion: boolean;
  preserve_camera: boolean;
  preserve_subject: boolean;
  preserve_audio: boolean;
  output_resolution: "480p" | "720p";
  output_fps: 24 | 25 | 30;
  seed: number;
  trim_start_seconds: number;
  trim_duration_seconds: number | null;
  status: "draft" | "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress: number;
  execution_name: string | null;
  output_storage_path: string | null;
  output_url: string | null;
  thumbnail_storage_path: string | null;
  thumbnail_url: string | null;
  gpu_seconds: number | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export function toPublicVideoEnhance(row: VideoEnhanceRow) {
  return {
    id: row.id,
    title: row.title,
    sourceUrl: row.source_url,
    sourceFilename: row.source_filename,
    sourceSizeBytes: row.source_size_bytes,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    model: row.model,
    mode: row.mode,
    transformStrength: Number(row.transform_strength),
    preserveMotion: row.preserve_motion,
    preserveCamera: row.preserve_camera,
    preserveSubject: row.preserve_subject,
    preserveAudio: row.preserve_audio,
    outputResolution: row.output_resolution,
    outputFps: row.output_fps,
    seed: Number(row.seed),
    trimStartSeconds: Number(row.trim_start_seconds),
    trimDurationSeconds: row.trim_duration_seconds == null ? null : Number(row.trim_duration_seconds),
    status: row.status,
    progress: row.progress,
    outputUrl: row.output_url,
    thumbnailUrl: row.thumbnail_url,
    gpuSeconds: row.gpu_seconds == null ? null : Number(row.gpu_seconds),
    error: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getVideoEnhanceJob(admin: SupabaseClient, jobId: string, userId?: string) {
  let query = admin.from("video_enhance_jobs").select(VIDEO_ENHANCE_COLUMNS).eq("id", jobId);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("No se pudo recuperar el trabajo de video.");
  return data as unknown as VideoEnhanceRow | null;
}

export async function listVideoEnhanceJobs(admin: SupabaseClient, userId: string, limit = 20) {
  const { data, error } = await admin
    .from("video_enhance_jobs")
    .select(VIDEO_ENHANCE_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(50, limit)));
  if (error) throw new Error("No se pudo recuperar el historial de Video AI.");
  return (data ?? []) as unknown as VideoEnhanceRow[];
}

export function enhancePrompt(row: VideoEnhanceRow) {
  const locks = [
    row.preserve_motion ? "Preserve the original motion timing and action." : "",
    row.preserve_camera ? "Preserve the original camera movement, framing and shot timing." : "",
    row.preserve_subject ? "Preserve subject identity, body proportions and defining details." : "",
  ].filter(Boolean);
  const mode = row.mode === "faithful"
    ? "Keep the transformation faithful to the source video."
    : row.mode === "reimagine"
      ? "Reimagine the visual treatment while retaining the source choreography."
      : "Balance source fidelity with the requested visual transformation.";
  return [row.prompt.trim(), mode, ...locks].filter(Boolean).join(" ");
}
