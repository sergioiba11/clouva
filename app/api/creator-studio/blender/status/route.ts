import { NextResponse } from "next/server";
import {
  evaluateRigJobWatchdog,
  extractRigJobActivityAt,
  RIG_JOB_INACTIVITY_TIMEOUT_MS,
} from "@/lib/creator-studio/job-watchdog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const doneStates = new Set(["completed", "complete", "finished", "done", "success", "succeeded"]);
const failedStates = new Set(["failed", "error", "cancelled", "canceled"]);

type RuntimeJobActivity = {
  firstSeenAt: number;
  lastActivityAt: number;
  fingerprint: string | null;
};

type WatchdogGlobal = typeof globalThis & {
  __clouvaRigJobActivity?: Map<string, RuntimeJobActivity>;
};

function activityRegistry() {
  const target = globalThis as WatchdogGlobal;
  target.__clouvaRigJobActivity ??= new Map<string, RuntimeJobActivity>();
  return target.__clouvaRigJobActivity;
}

function pruneActivityRegistry(now: number) {
  const registry = activityRegistry();
  const maximumAge = 60 * 60 * 1000;
  for (const [jobId, activity] of registry) {
    if (now - activity.lastActivityAt > maximumAge) registry.delete(jobId);
  }
}

function normalizeStatus(data: Record<string, unknown>) {
  return String(data.status ?? data.state ?? "processing").toLowerCase();
}

function normalizeProgress(data: Record<string, unknown>) {
  const progressValue = Number(data.progress ?? data.percent ?? data.percentage ?? 0);
  return Number.isFinite(progressValue)
    ? Math.max(0, Math.min(100, progressValue))
    : 0;
}

function normalizedStage(data: Record<string, unknown>) {
  const stage = data.stage ?? data.step ?? data.message ?? null;
  return stage === null || stage === undefined ? null : String(stage);
}

function workerFingerprint(args: {
  status: string;
  progress: number;
  stage: string | null;
  hasResult: boolean;
}) {
  return JSON.stringify(args);
}

function runtimeActivity(jobId: string, now: number) {
  const registry = activityRegistry();
  const existing = registry.get(jobId);
  if (existing) return existing;

  const created: RuntimeJobActivity = {
    firstSeenAt: now,
    lastActivityAt: now,
    fingerprint: null,
  };
  registry.set(jobId, created);
  return created;
}

function evaluateActivity(args: {
  jobId: string;
  status: string;
  progress: number;
  stage: string | null;
  data: Record<string, unknown>;
  now: number;
}) {
  const hasResult = Boolean(args.data.resultUrl ?? args.data.outputUrl ?? args.data.downloadUrl);
  const fingerprint = workerFingerprint({
    status: args.status,
    progress: args.progress,
    stage: args.stage,
    hasResult,
  });
  const activity = runtimeActivity(args.jobId, args.now);
  const reportedActivityAt = extractRigJobActivityAt(args.data, args.now);

  if (
    activity.fingerprint === null ||
    activity.fingerprint !== fingerprint ||
    (reportedActivityAt !== null && reportedActivityAt > activity.lastActivityAt)
  ) {
    activity.lastActivityAt = args.now;
    activity.fingerprint = fingerprint;
  }

  return evaluateRigJobWatchdog({
    status: args.status,
    data: {
      ...args.data,
      lastActivityAt: new Date(activity.lastActivityAt).toISOString(),
    },
    now: args.now,
  });
}

function evaluateUnavailableWorker(jobId: string, now: number) {
  const activity = runtimeActivity(jobId, now);
  return evaluateRigJobWatchdog({
    status: "processing",
    data: { lastActivityAt: new Date(activity.lastActivityAt).toISOString() },
    now,
  });
}

function timeoutPayload(args: {
  jobId: string;
  progress: number;
  data: Record<string, unknown>;
  watchdog: ReturnType<typeof evaluateRigJobWatchdog>;
}) {
  const minutes = Math.round(RIG_JOB_INACTIVITY_TIMEOUT_MS / 60_000);
  return {
    ok: true,
    jobId: args.jobId,
    status: "failed",
    progress: args.progress,
    stage: "Tiempo de espera agotado",
    resultUrl: null,
    error: `El Blender Worker no informó actividad durante ${minutes} minutos. El trabajo fue liberado para que puedas reintentarlo.`,
    riggingStrategy: args.data.riggingStrategy ?? null,
    templateMode: Boolean(args.data.templateMode),
    watchdog: args.watchdog,
    raw: args.data,
  };
}

function timeoutResponse(args: {
  jobId: string;
  progress: number;
  data: Record<string, unknown>;
  watchdog: ReturnType<typeof evaluateRigJobWatchdog>;
}) {
  activityRegistry().delete(args.jobId);
  return NextResponse.json(timeoutPayload(args), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  const now = Date.now();
  pruneActivityRegistry(now);

  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId")?.trim();

    if (!jobId) {
      return NextResponse.json({ error: "Falta jobId." }, { status: 400 });
    }

    runtimeActivity(jobId, now);

    const workerUrl =
      process.env.GARMENT_WORKER_URL ??
      process.env.BLENDER_WORKER_URL ??
      "https://rig.clouva.com.ar";
    const workerToken =
      process.env.GARMENT_WORKER_TOKEN ??
      process.env.BLENDER_WORKER_TOKEN;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    let response: Response;
    try {
      response = await fetch(
        `${workerUrl.replace(/\/$/, "")}/jobs/${encodeURIComponent(jobId)}`,
        {
          method: "GET",
          headers: workerToken
            ? { Authorization: `Bearer ${workerToken}` }
            : undefined,
          cache: "no-store",
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timeout);
    }

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const status = normalizeStatus(data);
    const progress = normalizeProgress(data);
    const stage = normalizedStage(data);
    const watchdog = evaluateActivity({ jobId, status, progress, stage, data, now });

    if (watchdog.expired) {
      return timeoutResponse({ jobId, progress, data, watchdog });
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "No se pudo consultar el estado del Auto Rig.",
          status: response.status,
          details: data,
          watchdog,
        },
        {
          status: response.status,
          headers: {
            "Cache-Control": "private, no-store",
            "Retry-After": "3",
          },
        },
      );
    }

    const workerHasResult = Boolean(data.resultUrl ?? data.outputUrl ?? data.downloadUrl);
    const resultUrl = workerHasResult || doneStates.has(status)
      ? `/api/creator-studio/blender/result?jobId=${encodeURIComponent(jobId)}`
      : null;

    if (doneStates.has(status) || failedStates.has(status)) {
      activityRegistry().delete(jobId);
    }

    return NextResponse.json(
      {
        ok: true,
        jobId,
        status,
        progress,
        stage,
        resultUrl,
        error: data.error ?? data.failureReason ?? null,
        riggingStrategy: data.riggingStrategy ?? null,
        templateMode: Boolean(data.templateMode),
        watchdog,
        raw: data,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId")?.trim();
    const timedOut = error instanceof Error && error.name === "AbortError";

    if (jobId) {
      const watchdog = evaluateUnavailableWorker(jobId, now);
      if (watchdog.expired) {
        return timeoutResponse({
          jobId,
          progress: 0,
          data: {},
          watchdog,
        });
      }
    }

    return NextResponse.json(
      {
        error: timedOut
          ? "El Blender Worker tardó demasiado en responder. CLOUVA volverá a consultar el trabajo."
          : error instanceof Error
            ? error.message
            : "Error inesperado al consultar el Auto Rig.",
      },
      {
        status: timedOut ? 504 : 500,
        headers: {
          "Cache-Control": "private, no-store",
          "Retry-After": "3",
        },
      },
    );
  }
}
