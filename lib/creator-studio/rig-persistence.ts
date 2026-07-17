import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export const RIG_JOB_ACTIVE_STATUSES = ["creating", "queued", "processing"] as const;
export const RIG_JOB_TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;

export type RigJobStatus =
  | (typeof RIG_JOB_ACTIVE_STATUSES)[number]
  | (typeof RIG_JOB_TERMINAL_STATUSES)[number];
export type RigLogLevel = "debug" | "info" | "warning" | "error";
export type RigLogSource = "api" | "worker" | "blender" | "watchdog";

export type RigJobRow = {
  id: string;
  user_id: string;
  asset_id: string | null;
  worker_job_id: string | null;
  status: RigJobStatus;
  stage: string | null;
  progress: number;
  rigging_strategy: string | null;
  template_mode: boolean;
  request_payload: Record<string, unknown>;
  worker_snapshot: Record<string, unknown>;
  worker_fingerprint: string | null;
  result_storage_path: string | null;
  error_message: string | null;
  started_at: string;
  last_activity_at: string;
  last_synced_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export class RigPersistenceError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "RigPersistenceError";
    this.statusCode = statusCode;
  }
}

let adminClient: SupabaseClient | null = null;

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new RigPersistenceError(`Falta la variable server-side ${name}.`);
  return value;
}

export function getRigPersistenceAdmin() {
  if (typeof window !== "undefined") {
    throw new RigPersistenceError(
      "La persistencia administrativa de rig solo puede usarse en el servidor.",
    );
  }

  if (adminClient) return adminClient;

  adminClient = createClient(
    requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: { "X-Client-Info": "clouva-rig-persistence" },
      },
    },
  );

  return adminClient;
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

export async function requireRigUser(request: Request): Promise<User> {
  const accessToken = bearerToken(request);
  if (!accessToken) {
    throw new RigPersistenceError("Sesión requerida para administrar trabajos de rig.", 401);
  }

  const { data, error } = await getRigPersistenceAdmin().auth.getUser(accessToken);
  if (error || !data.user) {
    throw new RigPersistenceError("La sesión de CLOUVA no es válida o venció.", 401);
  }

  return data.user;
}

export function normalizeRigJobStatus(
  value: unknown,
  fallback: RigJobStatus = "processing",
): RigJobStatus {
  const status = String(value ?? "").trim().toLowerCase();

  if (["creating", "uploading", "preparing"].includes(status)) return "creating";
  if (["queued", "queue", "pending", "accepted"].includes(status)) return "queued";
  if (["processing", "running", "started", "working", "in_progress"].includes(status)) {
    return "processing";
  }
  if (["completed", "complete", "finished", "done", "success", "succeeded"].includes(status)) {
    return "completed";
  }
  if (["failed", "failure", "error", "timed_out", "timeout"].includes(status)) {
    return "failed";
  }
  if (["cancelled", "canceled"].includes(status)) return "cancelled";

  return fallback;
}

export function isRigJobActive(status: RigJobStatus) {
  return (RIG_JOB_ACTIVE_STATUSES as readonly string[]).includes(status);
}

export function isRigJobTerminal(status: RigJobStatus) {
  return (RIG_JOB_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function normalizeRigProgress(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function sanitizeRigLogMessage(value: unknown, maximumLength = 16_000) {
  const message = String(value ?? "").replace(/\u0000/g, "").trim();
  if (!message) return "Evento de rig sin mensaje.";
  if (message.length <= maximumLength) return message;
  return `${message.slice(0, maximumLength)}\n… [log truncado por CLOUVA]`;
}

export function buildRigWorkerFingerprint(args: {
  status: RigJobStatus;
  progress: number;
  stage?: string | null;
  errorMessage?: string | null;
  resultStoragePath?: string | null;
}) {
  return JSON.stringify({
    status: args.status,
    progress: normalizeRigProgress(args.progress),
    stage: args.stage?.trim() || null,
    errorMessage: args.errorMessage?.trim() || null,
    resultStoragePath: args.resultStoragePath?.trim() || null,
  });
}

function databaseFailure(prefix: string, error: { message?: string } | null) {
  return new RigPersistenceError(
    `${prefix}: ${error?.message || "error desconocido de Supabase"}`,
  );
}

export async function createRigJob(input: {
  userId: string;
  assetId?: string | null;
  riggingStrategy?: string | null;
  templateMode?: boolean;
  requestPayload?: Record<string, unknown>;
}) {
  const { data, error } = await getRigPersistenceAdmin()
    .from("rig_jobs")
    .insert({
      user_id: input.userId,
      asset_id: input.assetId ?? null,
      status: "creating",
      stage: "Preparando trabajo",
      progress: 0,
      rigging_strategy: input.riggingStrategy ?? null,
      template_mode: Boolean(input.templateMode),
      request_payload: input.requestPayload ?? {},
    })
    .select("*")
    .single();

  if (error || !data) {
    throw databaseFailure("No se pudo crear el registro persistente del rig", error);
  }
  return data as RigJobRow;
}

export async function attachWorkerJob(input: {
  rigJobId: string;
  userId: string;
  workerJobId: string;
  status?: unknown;
  stage?: string | null;
  progress?: unknown;
  workerSnapshot?: Record<string, unknown>;
}) {
  const status = normalizeRigJobStatus(input.status, "queued");
  const progress = status === "completed" ? 100 : normalizeRigProgress(input.progress);
  const now = new Date().toISOString();
  const fingerprint = buildRigWorkerFingerprint({
    status,
    progress,
    stage: input.stage,
  });

  const { data, error } = await getRigPersistenceAdmin()
    .from("rig_jobs")
    .update({
      worker_job_id: input.workerJobId,
      status,
      stage:
        input.stage?.trim() ||
        (status === "queued" ? "Trabajo aceptado por Blender" : null),
      progress,
      worker_snapshot: input.workerSnapshot ?? {},
      worker_fingerprint: fingerprint,
      last_activity_at: now,
      last_synced_at: now,
      finished_at: isRigJobTerminal(status) ? now : null,
    })
    .eq("id", input.rigJobId)
    .eq("user_id", input.userId)
    .select("*")
    .single();

  if (error || !data) throw databaseFailure("No se pudo asociar el job externo", error);
  return data as RigJobRow;
}

export async function getRigJobForUser(rigJobId: string, userId: string) {
  const { data, error } = await getRigPersistenceAdmin()
    .from("rig_jobs")
    .select("*")
    .eq("id", rigJobId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw databaseFailure("No se pudo consultar el trabajo de rig", error);
  return data ? (data as RigJobRow) : null;
}

export async function listActiveRigJobs(userId: string, limit = 10) {
  const safeLimit = Math.max(1, Math.min(50, Math.round(limit)));
  const { data, error } = await getRigPersistenceAdmin()
    .from("rig_jobs")
    .select("*")
    .eq("user_id", userId)
    .in("status", [...RIG_JOB_ACTIVE_STATUSES])
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw databaseFailure("No se pudieron recuperar los rigs activos", error);
  return (data ?? []) as RigJobRow[];
}

export async function appendRigLog(input: {
  rigJobId: string;
  userId: string;
  level?: RigLogLevel;
  source?: RigLogSource;
  stage?: string | null;
  message: unknown;
  metadata?: Record<string, unknown>;
  dedupeKey?: string | null;
}) {
  const row = {
    rig_job_id: input.rigJobId,
    user_id: input.userId,
    level: input.level ?? "info",
    source: input.source ?? "api",
    stage: input.stage?.trim() || null,
    message: sanitizeRigLogMessage(input.message),
    metadata: input.metadata ?? {},
    dedupe_key: input.dedupeKey?.trim() || null,
  };

  const query = input.dedupeKey
    ? getRigPersistenceAdmin()
        .from("rig_logs")
        .upsert(row, { onConflict: "rig_job_id,dedupe_key", ignoreDuplicates: true })
    : getRigPersistenceAdmin().from("rig_logs").insert(row);

  const { error } = await query;
  if (error) throw databaseFailure("No se pudo registrar el evento del rig", error);
}

export async function updateRigJobFromWorker(input: {
  job: RigJobRow;
  workerData: Record<string, unknown>;
  resultStoragePath?: string | null;
}) {
  const status = normalizeRigJobStatus(
    input.workerData.status ?? input.workerData.state,
    input.job.status,
  );
  const progress =
    status === "completed"
      ? 100
      : normalizeRigProgress(
          input.workerData.progress ??
            input.workerData.percent ??
            input.workerData.percentage ??
            input.job.progress,
        );
  const rawStage = input.workerData.stage ?? input.workerData.step ?? input.workerData.message;
  const stage = rawStage === null || rawStage === undefined ? input.job.stage : String(rawStage);
  const rawError = input.workerData.error ?? input.workerData.failureReason;
  const errorMessage =
    rawError === null || rawError === undefined ? null : sanitizeRigLogMessage(rawError, 4_000);
  const resultStoragePath = input.resultStoragePath ?? input.job.result_storage_path;
  const fingerprint = buildRigWorkerFingerprint({
    status,
    progress,
    stage,
    errorMessage,
    resultStoragePath,
  });
  const now = new Date().toISOString();
  const changed = fingerprint !== input.job.worker_fingerprint;

  const { data, error } = await getRigPersistenceAdmin()
    .from("rig_jobs")
    .update({
      status,
      stage: stage?.trim() || null,
      progress,
      worker_snapshot: input.workerData,
      worker_fingerprint: fingerprint,
      last_synced_at: now,
      ...(changed ? { last_activity_at: now } : {}),
      result_storage_path: resultStoragePath,
      error_message: errorMessage,
      finished_at: isRigJobTerminal(status) ? input.job.finished_at ?? now : null,
    })
    .eq("id", input.job.id)
    .eq("user_id", input.job.user_id)
    .select("*")
    .single();

  if (error || !data) throw databaseFailure("No se pudo sincronizar el estado del rig", error);
  return { job: data as RigJobRow, changed };
}

export async function markRigJobFailed(input: {
  rigJobId: string;
  userId: string;
  message: unknown;
  stage?: string | null;
  source?: RigLogSource;
  metadata?: Record<string, unknown>;
}) {
  const now = new Date().toISOString();
  const errorMessage = sanitizeRigLogMessage(input.message, 4_000);
  const stage = input.stage?.trim() || "Proceso con error";
  const fingerprint = buildRigWorkerFingerprint({
    status: "failed",
    progress: 0,
    stage,
    errorMessage,
  });

  const { data, error } = await getRigPersistenceAdmin()
    .from("rig_jobs")
    .update({
      status: "failed",
      stage,
      error_message: errorMessage,
      worker_fingerprint: fingerprint,
      last_activity_at: now,
      last_synced_at: now,
      finished_at: now,
    })
    .eq("id", input.rigJobId)
    .eq("user_id", input.userId)
    .select("*")
    .single();

  if (error || !data) throw databaseFailure("No se pudo marcar el rig como fallido", error);

  await appendRigLog({
    rigJobId: input.rigJobId,
    userId: input.userId,
    level: "error",
    source: input.source ?? "api",
    stage,
    message: errorMessage,
    metadata: input.metadata,
    dedupeKey: `failed:${fingerprint}`,
  });

  return data as RigJobRow;
}
