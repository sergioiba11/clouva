
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

async function signedAvatarUrl(
  supabase: ReturnType<typeof getAdminClient>,
  storagePath: string,
) {
  const { data: signed } = await supabase.storage.from("avatars").createSignedUrl(storagePath, 60 * 60);
  if (signed?.signedUrl) return asHttpsUrl(signed.signedUrl);
  return asHttpsUrl(supabase.storage.from("avatars").getPublicUrl(storagePath).data.publicUrl);
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
    const storedOriginal = storagePath && !looksDerivedRig(storagePath)
      ? await signedAvatarUrl(supabase, storagePath)
      : null;
    const meshyOriginal = asHttpsUrl(metadata.original_meshy_url);
    const modelUrl = asHttpsUrl(row.model_url);
    const originalUrl = storedOriginal
      ?? meshyOriginal
      ?? (modelUrl && !looksDerivedRig(modelUrl) ? modelUrl : null);
    if (originalUrl) {
      return {
        avatarId: typeof row.id === "string" ? row.id : null,
        metadata,
        sourceUrl: originalUrl,
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
    return { avatarId: null, metadata: {}, sourceUrl: profileUrl };
  }
  throw new Error("No encontramos el GLB original limpio del avatar para analizar");
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
