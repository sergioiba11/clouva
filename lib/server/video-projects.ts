import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { VIDEO_QUALITY_CONFIG, estimateVideoCostUsd, type VideoDuration, type VideoQuality } from "@/lib/media-generation-config";
import { generatedMediaGsUri, generatedMediaObjectFromGsUri } from "@/lib/gcs-media";
import { getVideoProvider } from "@/lib/video/providers";
import { enqueueVideoProjectStep } from "@/lib/server/cloud-tasks";
import { runVideoRenderJob } from "@/lib/cloud-run-jobs";

export const VIDEO_PROJECT_COLUMNS = [
  "id", "user_id", "title", "description", "master_prompt", "style_prompt",
  "provider", "model", "quality", "aspect_ratio", "target_duration_seconds",
  "maintain_style", "maintain_character", "use_frame_continuity", "generate_clip_audio",
  "project_mode", "visualizer_reactivity", "audio_analysis_status", "audio_analysis",
  "audio_analysis_error", "audio_analysis_execution_name",
  "reference_assets", "audio_storage_path", "audio_url", "status", "progress",
  "estimated_cost_usd", "actual_cost_usd", "cost_confirmed_at", "render_execution_name",
  "output_storage_path", "output_url", "thumbnail_storage_path", "thumbnail_url",
  "error_code", "error_message", "started_at", "completed_at", "created_at", "updated_at",
].join(",");

export const VIDEO_PROJECT_JOB_COLUMNS = [
  "id", "user_id", "project_id", "sequence_index", "provider", "type", "source_mode",
  "status", "prompt", "negative_prompt", "model", "aspect_ratio", "quality", "duration_seconds",
  "reference_storage_path", "reference_url", "last_frame_storage_path", "last_frame_url",
  "output_storage_path", "output_url", "mime_type", "operation_id", "provider_metadata",
  "estimated_cost_usd", "actual_cost_usd", "attempt_count", "last_error", "next_retry_at",
  "last_provider_sync_at", "error_code", "error_message", "started_at", "completed_at",
  "created_at", "updated_at",
].join(",");

export type VideoProjectRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  master_prompt: string;
  style_prompt: string;
  provider: string;
  model: string;
  quality: VideoQuality;
  aspect_ratio: "16:9" | "9:16";
  target_duration_seconds: number;
  maintain_style: boolean;
  maintain_character: boolean;
  use_frame_continuity: boolean;
  generate_clip_audio: boolean;
  project_mode: "video" | "visualizer";
  visualizer_reactivity: number;
  audio_analysis_status: "idle" | "queued" | "analyzing" | "completed" | "failed";
  audio_analysis: Record<string, unknown> | null;
  audio_analysis_error: string | null;
  audio_analysis_execution_name: string | null;
  reference_assets: unknown[];
  audio_storage_path: string | null;
  audio_url: string | null;
  status: string;
  progress: number;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  cost_confirmed_at: string | null;
  render_execution_name: string | null;
  output_storage_path: string | null;
  output_url: string | null;
  thumbnail_storage_path: string | null;
  thumbnail_url: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type VideoProjectJobRow = {
  id: string;
  user_id: string;
  project_id: string;
  sequence_index: number;
  provider: string;
  type: "video";
  source_mode: "text" | "reference";
  status: string;
  prompt: string;
  negative_prompt: string | null;
  model: string;
  aspect_ratio: "16:9" | "9:16";
  quality: VideoQuality;
  duration_seconds: VideoDuration;
  reference_storage_path: string | null;
  reference_url: string | null;
  last_frame_storage_path: string | null;
  last_frame_url: string | null;
  output_storage_path: string | null;
  output_url: string | null;
  mime_type: string | null;
  operation_id: string | null;
  provider_metadata: Record<string, unknown> | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  attempt_count: number;
  last_error: string | null;
  next_retry_at: string | null;
  last_provider_sync_at: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type VideoProjectFrame = {
  url: string;
  storagePath?: string | null;
  mimeType?: string | null;
};

export function toPublicVideoProject(row: VideoProjectRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    masterPrompt: row.master_prompt,
    stylePrompt: row.style_prompt,
    provider: row.provider,
    model: row.model,
    quality: row.quality,
    aspectRatio: row.aspect_ratio,
    targetDurationSeconds: row.target_duration_seconds,
    maintainStyle: row.maintain_style,
    maintainCharacter: row.maintain_character,
    useFrameContinuity: row.use_frame_continuity,
    generateClipAudio: row.generate_clip_audio,
    projectMode: row.project_mode,
    visualizerReactivity: Number(row.visualizer_reactivity || 1),
    audioAnalysisStatus: row.audio_analysis_status,
    audioAnalysis: row.audio_analysis,
    audioAnalysisError: row.audio_analysis_error,
    referenceAssets: Array.isArray(row.reference_assets) ? row.reference_assets : [],
    audioUrl: row.audio_url,
    status: row.status,
    progress: row.progress,
    estimatedCostUsd: row.estimated_cost_usd,
    actualCostUsd: row.actual_cost_usd,
    outputUrl: row.output_url,
    thumbnailUrl: row.thumbnail_url,
    error: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toPublicVideoProjectJob(row: VideoProjectJobRow) {
  return {
    id: row.id,
    sequenceIndex: row.sequence_index,
    status: row.status,
    prompt: row.prompt,
    provider: row.provider,
    model: row.model,
    aspectRatio: row.aspect_ratio,
    quality: row.quality,
    durationSeconds: row.duration_seconds,
    firstFrameUrl: row.reference_url,
    lastFrameUrl: row.last_frame_url,
    outputUrl: row.output_url,
    estimatedCostUsd: row.estimated_cost_usd,
    actualCostUsd: row.actual_cost_usd,
    attemptCount: row.attempt_count,
    error: row.error_message ?? row.last_error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

export async function getVideoProject(admin: SupabaseClient, projectId: string, userId?: string) {
  let query = admin.from("video_projects").select(VIDEO_PROJECT_COLUMNS).eq("id", projectId);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("No se pudo recuperar el proyecto de video.");
  return data as unknown as VideoProjectRow | null;
}

export async function listVideoProjectJobs(admin: SupabaseClient, projectId: string) {
  const { data, error } = await admin
    .from("media_generation_jobs")
    .select(VIDEO_PROJECT_JOB_COLUMNS)
    .eq("project_id", projectId)
    .eq("type", "video")
    .order("sequence_index", { ascending: true });
  if (error) throw new Error("No se pudieron recuperar los clips del proyecto.");
  return (data ?? []) as unknown as VideoProjectJobRow[];
}

function planDurations(targetSeconds: number): VideoDuration[] {
  const durations: VideoDuration[] = [];
  let remaining = Math.max(4, Math.ceil(targetSeconds));
  while (remaining > 0) {
    if (remaining >= 8) {
      durations.push(8);
      remaining -= 8;
    } else if (remaining <= 4) {
      durations.push(4);
      remaining = 0;
    } else if (remaining <= 6) {
      durations.push(6);
      remaining = 0;
    } else {
      durations.push(8);
      remaining = 0;
    }
  }
  return durations;
}

function composeClipPrompt(project: VideoProjectRow, sequenceIndex: number, total: number) {
  const parts = [project.master_prompt.trim()];
  if (project.maintain_style && project.style_prompt.trim()) {
    parts.push(`STYLE LOCK — preserve across every clip:\n${project.style_prompt.trim()}`);
  }
  if (project.maintain_character) {
    parts.push("IDENTITY LOCK — preserve the same character identity, face, body, clothes and defining visual details.");
  }
  parts.push(`This is clip ${sequenceIndex + 1} of ${total}. Preserve continuity with the surrounding clips and do not add titles, captions, logos or text unless the project prompt explicitly requires them.`);
  return parts.filter(Boolean).join("\n\n").slice(0, 4000);
}

type AudioFlowSection = { start?: number; end?: number; energy?: number; label?: string };
type AudioFlowEvent = { time?: number; type?: string; strength?: number };

function audioFlowPrompt(project: VideoProjectRow, job: VideoProjectJobRow, jobs: VideoProjectJobRow[]) {
  if (project.project_mode !== "visualizer" || project.audio_analysis_status !== "completed" || !project.audio_analysis) {
    return job.prompt;
  }

  const analysis = project.audio_analysis;
  const bpm = Number(analysis.bpm || 0);
  const sections = Array.isArray(analysis.sections) ? analysis.sections as AudioFlowSection[] : [];
  const events = Array.isArray(analysis.events) ? analysis.events as AudioFlowEvent[] : [];
  const ordered = [...jobs].sort((a, b) => a.sequence_index - b.sequence_index);
  const analyzedDuration = Number(analysis.durationSeconds || 0);
  const start = project.project_mode === "visualizer" && analyzedDuration > 0
    ? (job.sequence_index / Math.max(1, ordered.length)) * analyzedDuration
    : ordered
      .filter((item) => item.sequence_index < job.sequence_index)
      .reduce((sum, item) => sum + Number(item.duration_seconds || 0), 0);
  const end = project.project_mode === "visualizer" && analyzedDuration > 0
    ? ((job.sequence_index + 1) / Math.max(1, ordered.length)) * analyzedDuration
    : start + Number(job.duration_seconds || 0);
  const section = sections.find((item) => Number(item.start ?? 0) <= start && Number(item.end ?? 0) > start)
    ?? sections.find((item) => Number(item.start ?? 0) < end && Number(item.end ?? 0) > start);
  const localEvents = events
    .filter((item) => Number(item.time ?? -1) >= start && Number(item.time ?? -1) < end)
    .slice(0, 12);
  const eventSummary = localEvents.length
    ? localEvents.map((item) => `${item.type || "accent"}@${Number(item.time || 0).toFixed(2)}s`).join(", ")
    : "no major accent detected";
  const energy = Number(section?.energy ?? 0.5);
  const energyLabel = section?.label || (energy >= 0.7 ? "high" : energy <= 0.35 ? "low" : "medium");
  const motion = energy >= 0.7
    ? "Use stronger camera/body motion and clearer rhythmic accents."
    : energy <= 0.35
      ? "Keep motion restrained, floating and spacious; save strong movement for detected accents."
      : "Use controlled rhythmic motion with visible accents on the stronger hits.";

  const cue = [
    "AUDIO FLOW LOCK — the final master audio drives this visualizer.",
    `Timeline segment: ${start.toFixed(2)}s–${end.toFixed(2)}s.`,
    bpm > 0 ? `Detected tempo: ~${bpm.toFixed(1)} BPM.` : "",
    `Section energy: ${energyLabel} (${energy.toFixed(2)}).`,
    `Local accents: ${eventSummary}.`,
    motion,
    "Do not generate text overlays unless explicitly requested. Preserve the same visual universe while making movement feel musical rather than random.",
  ].filter(Boolean).join("\n");

  return `${job.prompt.slice(0, 3000)}\n\n${cue}`.slice(0, 4000);
}

export async function createVideoProjectClipPlan(args: {
  admin: SupabaseClient;
  project: VideoProjectRow;
  frames: VideoProjectFrame[];
}) {
  if (!["draft", "failed"].includes(args.project.status)) {
    throw new Error("El proyecto ya está en generación y no puede replanificarse.");
  }

  const existing = await listVideoProjectJobs(args.admin, args.project.id);
  if (existing.some((job) => job.status !== "queued")) {
    throw new Error("El proyecto ya tiene clips iniciados.");
  }
  if (existing.length) {
    const { error } = await args.admin.from("media_generation_jobs").delete().eq("project_id", args.project.id);
    if (error) throw new Error("No se pudo reemplazar el plan anterior.");
  }

  const frameCount = args.frames.length;
  const visualizerSources = Math.max(
    1,
    Math.min(12, frameCount || Math.ceil(args.project.target_duration_seconds / 45)),
  );
  const visualizerSourceDuration: VideoDuration = args.project.target_duration_seconds <= 4
    ? 4
    : args.project.target_duration_seconds <= 6
      ? 6
      : 8;
  const durations = args.project.project_mode === "visualizer"
    ? Array.from({ length: visualizerSources }, () => visualizerSourceDuration)
    : planDurations(args.project.target_duration_seconds);
  const config = VIDEO_QUALITY_CONFIG[args.project.quality];
  const rows = durations.map((duration, sequenceIndex) => {
    const currentFrameIndex = frameCount
      ? Math.min(frameCount - 1, Math.floor((sequenceIndex / durations.length) * frameCount))
      : -1;
    const nextFrameIndex = frameCount
      ? Math.min(frameCount - 1, Math.floor(((sequenceIndex + 1) / durations.length) * frameCount))
      : -1;
    const firstFrame = currentFrameIndex >= 0 ? args.frames[currentFrameIndex] : null;
    const lastFrame = args.project.use_frame_continuity && nextFrameIndex > currentFrameIndex
      ? args.frames[nextFrameIndex]
      : null;
    return {
      user_id: args.project.user_id,
      project_id: args.project.id,
      sequence_index: sequenceIndex,
      idempotency_key: `vp_${args.project.id.replaceAll("-", "")}_${String(sequenceIndex).padStart(4, "0")}`,
      provider: "google_vertex_ai",
      type: "video",
      source_mode: firstFrame ? "reference" : "text",
      status: "queued",
      prompt: composeClipPrompt(args.project, sequenceIndex, durations.length),
      model: config.model,
      aspect_ratio: args.project.aspect_ratio,
      quality: args.project.quality,
      duration_seconds: duration,
      reference_storage_path: firstFrame?.storagePath ?? null,
      reference_url: firstFrame?.url ?? null,
      last_frame_storage_path: lastFrame?.storagePath ?? null,
      last_frame_url: lastFrame?.url ?? null,
      estimated_cost_usd: estimateVideoCostUsd(args.project.quality, duration),
      attempt_count: 0,
    };
  });

  const { data, error } = await args.admin
    .from("media_generation_jobs")
    .insert(rows)
    .select(VIDEO_PROJECT_JOB_COLUMNS)
    .order("sequence_index", { ascending: true });
  if (error) throw new Error(`No se pudo crear el plan de clips: ${error.message}`);

  const estimatedCost = rows.reduce((sum, row) => sum + Number(row.estimated_cost_usd || 0), 0);
  const { error: updateError } = await args.admin
    .from("video_projects")
    .update({
      provider: "google_vertex_ai",
      model: config.model,
      reference_assets: args.frames,
      estimated_cost_usd: Number(estimatedCost.toFixed(4)),
      actual_cost_usd: 0,
      cost_confirmed_at: null,
      status: "draft",
      progress: 0,
      error_code: null,
      error_message: null,
      output_storage_path: null,
      output_url: null,
      thumbnail_storage_path: null,
      thumbnail_url: null,
      render_execution_name: null,
      completed_at: null,
    })
    .eq("id", args.project.id)
    .eq("user_id", args.project.user_id);
  if (updateError) throw new Error("No se pudo actualizar el proyecto con el plan.");

  return (data ?? []) as unknown as VideoProjectJobRow[];
}

function parallelLimit() {
  const parsed = Number(process.env.CLOUVA_VIDEO_MAX_PARALLEL ?? 2);
  return Math.max(1, Math.min(4, Number.isFinite(parsed) ? Math.floor(parsed) : 2));
}

function resolutionForQuality(quality: VideoQuality): "720p" | "1080p" | "4k" {
  return VIDEO_QUALITY_CONFIG[quality].resolution;
}

async function markJobRetryOrFailure(admin: SupabaseClient, job: VideoProjectJobRow, message: string) {
  const attempts = Math.max(1, Number(job.attempt_count || 0));
  if (attempts < 3) {
    await admin.from("media_generation_jobs").update({
      status: "queued",
      operation_id: null,
      last_error: message.slice(0, 600),
      error_code: null,
      error_message: null,
      next_retry_at: new Date(Date.now() + Math.min(60, attempts * 15) * 1000).toISOString(),
    }).eq("id", job.id).eq("project_id", job.project_id);
    return;
  }
  await admin.from("media_generation_jobs").update({
    status: "failed",
    last_error: message.slice(0, 600),
    error_code: "provider_failed",
    error_message: "El clip no pudo generarse después de los reintentos automáticos.",
  }).eq("id", job.id).eq("project_id", job.project_id);
}

async function syncActiveClip(admin: SupabaseClient, job: VideoProjectJobRow) {
  if (!job.operation_id) return;
  try {
    const provider = getVideoProvider(job.provider);
    const operation = await provider.getStatus(job.operation_id);
    if (operation.error) throw new Error(operation.error);
    if (!operation.done) {
      await admin.from("media_generation_jobs").update({
        status: "processing",
        last_provider_sync_at: new Date().toISOString(),
        provider_metadata: {
          ...(job.provider_metadata ?? {}),
          operationMetadata: operation.metadata,
        },
      }).eq("id", job.id).eq("project_id", job.project_id);
      return;
    }
    if (!operation.outputUri) throw new Error("Vertex AI terminó sin devolver un video.");
    const stored = generatedMediaObjectFromGsUri(operation.outputUri);
    await admin.from("media_generation_jobs").update({
      status: "completed",
      output_storage_path: stored.objectPath,
      output_url: stored.url,
      mime_type: operation.mimeType || "video/mp4",
      provider_metadata: {
        ...(job.provider_metadata ?? {}),
        operationMetadata: operation.metadata,
        outputUri: operation.outputUri,
      },
      actual_cost_usd: job.estimated_cost_usd,
      error_code: null,
      error_message: null,
      last_error: null,
      completed_at: new Date().toISOString(),
      last_provider_sync_at: new Date().toISOString(),
    }).eq("id", job.id).eq("project_id", job.project_id);
  } catch (error) {
    await markJobRetryOrFailure(
      admin,
      job,
      error instanceof Error ? error.message : "Falló la sincronización del proveedor.",
    );
  }
}

async function startQueuedClip(admin: SupabaseClient, project: VideoProjectRow, job: VideoProjectJobRow, timelineJobs: VideoProjectJobRow[]) {
  const now = new Date().toISOString();
  const nextAttempt = Number(job.attempt_count || 0) + 1;
  const { data: claimed, error: claimError } = await admin
    .from("media_generation_jobs")
    .update({
      status: "generating",
      attempt_count: nextAttempt,
      started_at: job.started_at ?? now,
      next_retry_at: null,
      error_code: null,
      error_message: null,
    })
    .eq("id", job.id)
    .eq("project_id", project.id)
    .eq("status", "queued")
    .select(VIDEO_PROJECT_JOB_COLUMNS)
    .maybeSingle();
  if (claimError) throw new Error("No se pudo reservar el clip para generación.");
  if (!claimed) return false;

  const claimedJob = claimed as unknown as VideoProjectJobRow;
  try {
    const provider = getVideoProvider(claimedJob.provider);
    const outputPrefix = generatedMediaGsUri(
      `video-projects/${project.user_id}/${project.id}/clips/${String(claimedJob.sequence_index).padStart(4, "0")}-${claimedJob.id}`,
    );
    const operation = await provider.generate({
      prompt: audioFlowPrompt(project, claimedJob, timelineJobs),
      negativePrompt: claimedJob.negative_prompt,
      model: claimedJob.model,
      aspectRatio: project.aspect_ratio,
      durationSeconds: claimedJob.duration_seconds,
      resolution: resolutionForQuality(project.quality),
      firstFrame: claimedJob.reference_url ? {
        url: claimedJob.reference_url,
        storagePath: claimedJob.reference_storage_path,
      } : null,
      lastFrame: claimedJob.last_frame_url ? {
        url: claimedJob.last_frame_url,
        storagePath: claimedJob.last_frame_storage_path,
      } : null,
      outputGcsUri: outputPrefix,
      generateAudio: project.generate_clip_audio,
    });

    if (operation.done && operation.outputUri) {
      const stored = generatedMediaObjectFromGsUri(operation.outputUri);
      await admin.from("media_generation_jobs").update({
        status: "completed",
        operation_id: operation.operationName,
        output_storage_path: stored.objectPath,
        output_url: stored.url,
        mime_type: operation.mimeType || "video/mp4",
        provider_metadata: {
          provider: claimedJob.provider,
          outputPrefix,
          operationMetadata: operation.metadata,
        },
        actual_cost_usd: claimedJob.estimated_cost_usd,
        completed_at: new Date().toISOString(),
        last_provider_sync_at: new Date().toISOString(),
      }).eq("id", claimedJob.id).eq("project_id", project.id);
    } else {
      await admin.from("media_generation_jobs").update({
        status: operation.done ? "processing" : "generating",
        operation_id: operation.operationName,
        provider_metadata: {
          provider: claimedJob.provider,
          outputPrefix,
          operationMetadata: operation.metadata,
        },
        last_provider_sync_at: new Date().toISOString(),
      }).eq("id", claimedJob.id).eq("project_id", project.id);
    }
    return true;
  } catch (error) {
    await markJobRetryOrFailure(
      admin,
      { ...claimedJob, attempt_count: nextAttempt },
      error instanceof Error ? error.message : "No se pudo iniciar el clip.",
    );
    return false;
  }
}

function projectProgress(jobs: VideoProjectJobRow[]) {
  if (!jobs.length) return 0;
  const completed = jobs.filter((job) => job.status === "completed").length;
  return Math.min(90, Math.floor((completed / jobs.length) * 90));
}

export async function startProjectRender(admin: SupabaseClient, project: VideoProjectRow) {
  const jobs = await listVideoProjectJobs(admin, project.id);
  if (!jobs.length || jobs.some((job) => job.status !== "completed" || !job.output_storage_path)) {
    throw new Error("Todos los clips deben estar completos antes del render.");
  }

  const { data: claimed, error } = await admin
    .from("video_projects")
    .update({
      status: "compositing",
      progress: 95,
      error_code: null,
      error_message: null,
    })
    .eq("id", project.id)
    .eq("user_id", project.user_id)
    .in("status", ["queued", "generating", "processing"])
    .select(VIDEO_PROJECT_COLUMNS)
    .maybeSingle();
  if (error) throw new Error("No se pudo reservar el proyecto para composición.");
  if (!claimed) return project;

  try {
    const executionName = await runVideoRenderJob(project.id);
    const { data: updated, error: updateError } = await admin
      .from("video_projects")
      .update({ render_execution_name: executionName })
      .eq("id", project.id)
      .eq("user_id", project.user_id)
      .select(VIDEO_PROJECT_COLUMNS)
      .single();
    if (updateError || !updated) throw new Error("El render se inició, pero no pudo registrarse.");
    return updated as unknown as VideoProjectRow;
  } catch (error) {
    await admin.from("video_projects").update({
      status: "failed",
      error_code: "render_start_failed",
      error_message: error instanceof Error ? error.message.slice(0, 600) : "No se pudo iniciar el render.",
    }).eq("id", project.id).eq("user_id", project.user_id);
    throw error;
  }
}

export async function processVideoProjectStep(admin: SupabaseClient, projectId: string) {
  let project = await getVideoProject(admin, projectId);
  if (!project) throw new Error("El proyecto de video no existe.");
  if (["completed", "cancelled", "failed", "compositing"].includes(project.status)) return project;
  if (!project.cost_confirmed_at) throw new Error("El costo del proyecto todavía no fue confirmado.");

  let jobs = await listVideoProjectJobs(admin, project.id);
  if (!jobs.length) throw new Error("El proyecto no tiene clips planificados.");

  const active = jobs.filter((job) => ["generating", "processing"].includes(job.status) && job.operation_id);
  for (const job of active) await syncActiveClip(admin, job);

  jobs = await listVideoProjectJobs(admin, project.id);
  const activeCount = jobs.filter((job) => ["generating", "processing"].includes(job.status)).length;
  const slots = Math.max(0, parallelLimit() - activeCount);
  const now = Date.now();
  const queued = jobs.filter((job) => job.status === "queued" && (!job.next_retry_at || Date.parse(job.next_retry_at) <= now));
  for (const job of queued.slice(0, slots)) await startQueuedClip(admin, project, job, jobs);

  jobs = await listVideoProjectJobs(admin, project.id);
  const failed = jobs.filter((job) => job.status === "failed");
  const completed = jobs.filter((job) => job.status === "completed");
  const actualCost = completed.reduce((sum, job) => sum + Number(job.actual_cost_usd || 0), 0);

  if (failed.length) {
    const { data } = await admin.from("video_projects").update({
      status: "failed",
      progress: projectProgress(jobs),
      actual_cost_usd: Number(actualCost.toFixed(4)),
      error_code: "clip_failed",
      error_message: `${failed.length} clip(s) no pudieron generarse.`,
    }).eq("id", project.id).select(VIDEO_PROJECT_COLUMNS).single();
    return data as unknown as VideoProjectRow;
  }

  if (completed.length === jobs.length) {
    project = {
      ...project,
      actual_cost_usd: Number(actualCost.toFixed(4)),
      status: "processing",
    };
    await admin.from("video_projects").update({
      status: "processing",
      progress: 90,
      actual_cost_usd: project.actual_cost_usd,
    }).eq("id", project.id);
    return startProjectRender(admin, project);
  }

  const hasProcessing = jobs.some((job) => ["generating", "processing"].includes(job.status));
  const { data: updated, error: updateError } = await admin
    .from("video_projects")
    .update({
      status: hasProcessing ? "generating" : "queued",
      progress: projectProgress(jobs),
      actual_cost_usd: Number(actualCost.toFixed(4)),
      started_at: project.started_at ?? new Date().toISOString(),
      error_code: null,
      error_message: null,
    })
    .eq("id", project.id)
    .select(VIDEO_PROJECT_COLUMNS)
    .single();
  if (updateError || !updated) throw new Error("No se pudo actualizar el progreso del proyecto.");

  await enqueueVideoProjectStep(project.id, 15);
  return updated as unknown as VideoProjectRow;
}
