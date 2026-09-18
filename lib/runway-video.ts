const RUNWAY_BASE_URL = "https://api.dev.runwayml.com";
const RUNWAY_API_VERSION = "2024-11-06";

export type RunwayVideoModel = "seedance2_mini" | "seedance2_fast" | "seedance2_5";
export type RunwayVideoAspectRatio = "16:9" | "9:16";
export type RunwayVideoDuration = 4 | 6 | 8;
export type RunwayTaskStatus = "PENDING" | "THROTTLED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";

export type RunwayVideoTask = {
  id: string;
  status: RunwayTaskStatus;
  outputUrl: string | null;
  progress: number | null;
  failure: string | null;
  failureCode: string | null;
  metadata: Record<string, unknown> | null;
};

export class RunwayVideoError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 502, code = "runway_video_error") {
    super(message);
    this.name = "RunwayVideoError";
    this.status = status;
    this.code = code;
  }
}

type RunwayTaskPayload = {
  id?: string;
  status?: RunwayTaskStatus;
  output?: unknown[];
  progress?: number;
  failure?: string;
  failureCode?: string;
  error?: string | { message?: string; code?: string };
  message?: string;
  metadata?: Record<string, unknown>;
};

function headers(apiKey: string, json = false) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "X-Runway-Version": RUNWAY_API_VERSION,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function errorMessage(payload: RunwayTaskPayload, fallback: string) {
  if (typeof payload.error === "string") return payload.error;
  if (payload.error?.message) return payload.error.message;
  return payload.message || payload.failure || fallback;
}

function mapProviderStatus(status: number) {
  if (status === 401 || status === 403) return "runway_auth_failed";
  if (status === 402) return "runway_billing_required";
  if (status === 429) return "runway_rate_limited";
  return "runway_provider_failed";
}

function ratioFor(aspectRatio: RunwayVideoAspectRatio) {
  return aspectRatio === "9:16" ? "720:1280" : "1280:720";
}

function validateTaskId(taskId: string) {
  if (!/^[a-f0-9-]{20,80}$/i.test(taskId)) {
    throw new RunwayVideoError("Identificador de tarea de Runway inválido.", 400, "invalid_runway_task_id");
  }
}

function taskFromPayload(payload: RunwayTaskPayload, fallbackId?: string): RunwayVideoTask {
  const id = payload.id || fallbackId;
  if (!id) throw new RunwayVideoError("Runway no devolvió el identificador de la tarea.", 502, "missing_runway_task_id");
  const outputUrl = Array.isArray(payload.output)
    ? payload.output.find((value): value is string => typeof value === "string" && value.startsWith("https://")) ?? null
    : null;
  return {
    id,
    status: payload.status ?? "PENDING",
    outputUrl,
    progress: typeof payload.progress === "number" ? payload.progress : null,
    failure: payload.failure ?? null,
    failureCode: payload.failureCode ?? null,
    metadata: payload.metadata ?? null,
  };
}

export async function startRunwayVideoGeneration(args: {
  apiKey: string;
  prompt: string;
  model: RunwayVideoModel;
  aspectRatio: RunwayVideoAspectRatio;
  durationSeconds: RunwayVideoDuration;
  referenceUrl?: string | null;
  timeoutMs?: number;
}) {
  const response = await fetch(`${RUNWAY_BASE_URL}/v1/image_to_video`, {
    method: "POST",
    headers: headers(args.apiKey, true),
    body: JSON.stringify({
      model: args.model,
      promptText: args.prompt,
      ...(args.referenceUrl ? { promptImage: args.referenceUrl } : {}),
      ratio: ratioFor(args.aspectRatio),
      duration: args.durationSeconds,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(args.timeoutMs ?? 30_000),
  });
  const payload = await response.json().catch(() => ({})) as RunwayTaskPayload;
  if (!response.ok) {
    throw new RunwayVideoError(
      errorMessage(payload, `Runway respondió HTTP ${response.status}.`),
      response.status,
      mapProviderStatus(response.status),
    );
  }
  return taskFromPayload(payload);
}

export async function getRunwayVideoTask(args: { apiKey: string; taskId: string; timeoutMs?: number }) {
  validateTaskId(args.taskId);
  const response = await fetch(`${RUNWAY_BASE_URL}/v1/tasks/${encodeURIComponent(args.taskId)}`, {
    headers: headers(args.apiKey),
    cache: "no-store",
    signal: AbortSignal.timeout(args.timeoutMs ?? 20_000),
  });
  const payload = await response.json().catch(() => ({})) as RunwayTaskPayload;
  if (!response.ok) {
    throw new RunwayVideoError(
      errorMessage(payload, `No se pudo consultar la tarea de Runway (HTTP ${response.status}).`),
      response.status,
      mapProviderStatus(response.status),
    );
  }
  return taskFromPayload(payload, args.taskId);
}

export async function downloadRunwayVideo(args: { videoUrl: string; timeoutMs?: number; maxBytes?: number }) {
  const parsed = new URL(args.videoUrl);
  if (parsed.protocol !== "https:") {
    throw new RunwayVideoError("Runway devolvió una ubicación de video inválida.", 502, "invalid_runway_output_url");
  }
  const response = await fetch(parsed, {
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(args.timeoutMs ?? 120_000),
  });
  if (!response.ok) {
    throw new RunwayVideoError(`No se pudo descargar el video generado (HTTP ${response.status}).`, 502, "runway_download_failed");
  }
  const maxBytes = args.maxBytes ?? 250 * 1024 * 1024;
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > maxBytes) throw new RunwayVideoError("El video generado supera el tamaño permitido.", 413, "runway_output_too_large");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new RunwayVideoError("El video generado supera el tamaño permitido.", 413, "runway_output_too_large");
  return { bytes, mimeType: response.headers.get("content-type")?.split(";")[0] ?? "video/mp4" };
}
