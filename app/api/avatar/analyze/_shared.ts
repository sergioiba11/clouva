
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const DERIVED_RIG_PATTERN = /(?:complete-rigged|rigged|processed|final)(?:[-_.]|$)/i;
const METADATA_UPDATE_ATTEMPTS = 3;

type ErrorLike = {
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  code?: unknown;
  error?: unknown;
};

type MetadataRecord = Record<string, unknown>;

export type AnalyzerPendingJob = {
  jobId: string;
  avatarId: string;
  requestedRigProfile: "BODY_BASIC";
  startedAt: string;
  sourceKind: "active_avatar_original";
  status: "pending" | "error";
  error?: string;
  updatedAt: string;
};

function asMetadata(value: unknown): MetadataRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as MetadataRecord
    : {};
}

function asRecord(value: unknown): MetadataRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as MetadataRecord
    : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Faltan credenciales de Supabase en el servidor");
  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function errorMessage(cause: unknown) {
  if (cause instanceof Error && cause.message.trim()) return cause.message.trim();
  if (typeof cause === "string" && cause.trim()) return cause.trim();
  if (cause && typeof cause === "object") {
    const value = cause as ErrorLike;
    const parts = [value.message, value.details, value.hint, value.error]
      .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
      .map((part) => part.trim());
    if (parts.length) return parts.join(" · ");
  }
  return "No se pudo analizar el avatar";
}

export function asHttpsUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function looksDerivedRig(value: string | null) {
  return Boolean(value && DERIVED_RIG_PATTERN.test(value));
}

export async function requireUser(request: NextRequest) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!accessToken) throw new Error("Sesión requerida");
  const supabase = getAdminClient();
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Sesión inválida");
  return { supabase, user: data.user };
}

export async function resolveOriginalAvatar(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
) {
  const active = await supabase
    .from("user_avatars")
    .select("id,model_url,storage_path,metadata,updated_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!active.error && active.data) {
    const row = active.data as Record<string, unknown>;
    const storagePath = typeof row.storage_path === "string" && row.storage_path.trim()
      ? row.storage_path.trim()
      : null;
    const metadata = asMetadata(row.metadata);
    // sourceRef is either a bucket-relative Supabase Storage path (the
    // Cloud Run Job mints its own short-lived signed URL right before
    // downloading it -- see analyzer_job_entrypoint.py) or an already
    // fetchable external URL (Meshy/profile fallback below).
    const usableStoragePath = storagePath && !looksDerivedRig(storagePath) ? storagePath : null;
    const meshyOriginal = asHttpsUrl(metadata.original_meshy_url);
    const modelUrl = asHttpsUrl(row.model_url);
    const sourceRef = usableStoragePath
      ?? meshyOriginal
      ?? (modelUrl && !looksDerivedRig(modelUrl) ? modelUrl : null);
    if (sourceRef) {
      return {
        avatarId: typeof row.id === "string" ? row.id : null,
        metadata,
        sourceRef,
      };
    }
  }

  const profile = await supabase
    .from("profiles")
    .select("avatar_3d_url")
    .eq("id", userId)
    .maybeSingle();
  if (profile.error) throw new Error(`No se pudo leer el avatar: ${errorMessage(profile.error)}`);
  const profileUrl = asHttpsUrl(profile.data?.avatar_3d_url);
  if (profileUrl && !looksDerivedRig(profileUrl)) {
    return { avatarId: null, metadata: {}, sourceRef: profileUrl };
  }
  throw new Error("No encontramos el GLB original limpio del avatar para analizar");
}

export type AnalyzerJobRow = {
  id: string;
  user_id: string;
  avatar_id: string | null;
  operation: string;
  requested_rig_profile: string | null;
  status:
    | "queued" | "starting" | "running" | "persisting"
    | "completed" | "failed" | "cancel_requested" | "cancelled";
  progress: number | null;
  phase: string | null;
  source_storage_path: string | null;
  source_sha256: string | null;
  cloud_run_execution: string | null;
  run_id: string | null;
  result_prefix: string | null;
  error_code: string | null;
  error_message: string | null;
  summary: Record<string, unknown> | null;
};

export type WorkerJobStatus = {
  status: "pending" | "done" | "error" | "cancelled";
  runId?: string;
  summary?: Record<string, unknown>;
  detail?: string;
};

export function toWorkerJobStatus(row: AnalyzerJobRow): WorkerJobStatus {
  switch (row.status) {
    case "completed":
      return { status: "done", runId: row.run_id ?? undefined, summary: row.summary ?? undefined };
    case "failed":
      return { status: "error", detail: row.error_message ?? "El análisis falló" };
    case "cancelled":
      return { status: "cancelled" };
    default: // queued, starting, running, persisting, cancel_requested
      return { status: "pending" };
  }
}

const NON_TERMINAL_JOB_STATUSES = [
  "queued", "starting", "running", "persisting", "cancel_requested",
] as const;

/** Enforces "one analysis at a time" for a given avatar (or user, when there's
 * no avatarId) using the durable table as the source of truth -- unlike the
 * old single in-process lock, this holds even across separate Cloud Run Job
 * executions running on different container instances. */
export async function findActiveAnalyzerJob(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
  avatarId: string | null,
) {
  let query = supabase
    .from("avatar_analyzer_jobs")
    .select("id")
    .eq("user_id", userId)
    .in("status", NON_TERMINAL_JOB_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1);
  query = avatarId ? query.eq("avatar_id", avatarId) : query.is("avatar_id", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`No se pudo verificar análisis en curso: ${errorMessage(error)}`);
  return (data?.id as string | undefined) ?? null;
}

export async function createAnalyzerJob(args: {
  supabase: ReturnType<typeof getAdminClient>;
  userId: string;
  avatarId: string | null;
  sourceRef: string;
  requestedRigProfile: string;
  operation?: string;
}) {
  const { data, error } = await args.supabase
    .from("avatar_analyzer_jobs")
    .insert({
      user_id: args.userId,
      avatar_id: args.avatarId,
      operation: args.operation ?? "full_analysis",
      requested_rig_profile: args.requestedRigProfile,
      source_storage_path: args.sourceRef,
      status: "queued",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`No se pudo crear el trabajo de análisis: ${errorMessage(error)}`);
  return data.id as string;
}

export async function getAnalyzerJobForUser(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
  jobId: string,
) {
  const { data, error } = await supabase
    .from("avatar_analyzer_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo consultar el trabajo de análisis: ${errorMessage(error)}`);
  return data as AnalyzerJobRow | null;
}

export async function recordAnalyzerJobExecution(
  supabase: ReturnType<typeof getAdminClient>,
  jobId: string,
  executionName: string,
) {
  await supabase
    .from("avatar_analyzer_jobs")
    .update({ cloud_run_execution: executionName })
    .eq("id", jobId);
}

/** Marks a job cancel_requested (idempotent on already-terminal jobs). Returns
 * the row as it is *after* this call so the caller can decide whether a real
 * Cloud Run execution still needs to be cancelled. */
export async function requestAnalyzerJobCancellation(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
  jobId: string,
) {
  const current = await getAnalyzerJobForUser(supabase, userId, jobId);
  if (!current) return null;
  const terminal: AnalyzerJobRow["status"][] = ["completed", "failed", "cancelled"];
  if (terminal.includes(current.status) || current.status === "cancel_requested") return current;

  const { data, error } = await supabase
    .from("avatar_analyzer_jobs")
    .update({ status: "cancel_requested", cancelled_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error || !data) throw new Error(`No se pudo cancelar el análisis: ${errorMessage(error)}`);
  return data as AnalyzerJobRow;
}

async function mutateAvatarMetadata(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
  avatarId: string,
  mutate: (metadata: MetadataRecord) => MetadataRecord,
) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < METADATA_UPDATE_ATTEMPTS; attempt += 1) {
    const current = await supabase
      .from("user_avatars")
      .select("metadata,updated_at")
      .eq("id", avatarId)
      .eq("user_id", userId)
      .maybeSingle();
    if (current.error || !current.data) throw current.error || new Error("Avatar activo no encontrado");

    const updatedAt = new Date().toISOString();
    const nextMetadata = mutate(asMetadata(current.data.metadata));
    const baseUpdate = supabase
      .from("user_avatars")
      .update({ metadata: nextMetadata, updated_at: updatedAt })
      .eq("id", avatarId)
      .eq("user_id", userId);
    const result = current.data.updated_at
      ? await baseUpdate.eq("updated_at", current.data.updated_at).select("id").maybeSingle()
      : await baseUpdate.select("id").maybeSingle();
    if (!result.error && result.data) return nextMetadata;
    lastError = result.error || new Error("La metadata cambió durante la actualización");
    await sleep(60 * (attempt + 1));
  }
  throw lastError || new Error("No se pudo actualizar la metadata del Analyzer");
}

export async function persistPendingAnalyzerJob(args: {
  supabase: ReturnType<typeof getAdminClient>;
  userId: string;
  avatarId: string;
  jobId: string;
  startedAt?: string;
}) {
  const startedAt = args.startedAt || new Date().toISOString();
  return mutateAvatarMetadata(args.supabase, args.userId, args.avatarId, (metadata) => ({
    ...metadata,
    avatar_analyzer_v4_pending: {
      jobId: args.jobId,
      avatarId: args.avatarId,
      requestedRigProfile: "BODY_BASIC",
      startedAt,
      sourceKind: "active_avatar_original",
      status: "pending",
      updatedAt: new Date().toISOString(),
    } satisfies AnalyzerPendingJob,
  }));
}

export async function findAvatarForAnalyzerJob(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
  jobId: string,
) {
  const { data, error } = await supabase
    .from("user_avatars")
    .select("id,metadata,updated_at")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  for (const row of data || []) {
    const metadata = asMetadata(row.metadata);
    const pending = asRecord(metadata.avatar_analyzer_v4_pending);
    if (pending?.jobId === jobId) return { avatarId: row.id as string, metadata };
  }
  return null;
}

export async function persistCompletedAnalyzerJob(args: {
  supabase: ReturnType<typeof getAdminClient>;
  userId: string;
  avatarId: string;
  jobId: string;
  runId: string;
  summary: MetadataRecord;
}) {
  return mutateAvatarMetadata(args.supabase, args.userId, args.avatarId, (metadata) => {
    const next = { ...metadata };
    const pending = asRecord(next.avatar_analyzer_v4_pending);
    if (!pending || pending.jobId === args.jobId) delete next.avatar_analyzer_v4_pending;
    next.avatar_analyzer_v4 = {
      runId: args.runId,
      analyzerVersion: String(args.summary.analyzerVersion ?? "clouva-avatar-analyzer-v4.1"),
      mapVersion: "clouva-anatomical-map-v4.1",
      sourceSha256: String(args.summary.sourceSha256 ?? ""),
      status: String(args.summary.status ?? "needs_review"),
      requestedRigProfile: String(args.summary.requestedRigProfile ?? "BODY_BASIC"),
      summary: args.summary,
      updatedAt: new Date().toISOString(),
    };
    return next;
  });
}

export async function persistAnalyzerJobError(args: {
  supabase: ReturnType<typeof getAdminClient>;
  userId: string;
  avatarId: string;
  jobId: string;
  error: string;
}) {
  return mutateAvatarMetadata(args.supabase, args.userId, args.avatarId, (metadata) => {
    const pending = asRecord(metadata.avatar_analyzer_v4_pending);
    if (!pending || pending.jobId !== args.jobId) return metadata;
    return {
      ...metadata,
      avatar_analyzer_v4_pending: {
        ...pending,
        status: "error",
        error: args.error.slice(0, 1000),
        updatedAt: new Date().toISOString(),
      },
    };
  });
}

export async function persistCancelledAnalyzerJob(args: {
  supabase: ReturnType<typeof getAdminClient>;
  userId: string;
  avatarId: string;
  jobId: string;
}) {
  return mutateAvatarMetadata(args.supabase, args.userId, args.avatarId, (metadata) => {
    const pending = asRecord(metadata.avatar_analyzer_v4_pending);
    if (!pending || pending.jobId !== args.jobId) return metadata;
    const next = { ...metadata };
    delete next.avatar_analyzer_v4_pending;
    return next;
  });
}

export function workerError(raw: string) {
  if (!raw.trim()) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const detail = asRecord(parsed.detail);
    const value = detail?.message ?? parsed.detail ?? parsed.error ?? parsed.message;
    return typeof value === "string" ? value : JSON.stringify(value ?? parsed);
  } catch {
    return raw;
  }
}

export function workerBaseUrlAndToken() {
  const workerBaseUrl = (process.env.BLENDER_WORKER_URL || process.env.GARMENT_RIG_WORKER_URL)?.replace(/\/+$/, "");
  const workerToken = process.env.BLENDER_WORKER_TOKEN || process.env.GARMENT_RIG_WORKER_TOKEN;
  if (!workerBaseUrl) throw new Error("Falta configurar BLENDER_WORKER_URL");
  return { workerBaseUrl, workerToken };
}
