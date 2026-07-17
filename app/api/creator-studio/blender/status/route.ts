import { NextResponse } from "next/server";
import {
  evaluateRigJobWatchdog,
  RIG_JOB_INACTIVITY_TIMEOUT_MS,
} from "@/lib/creator-studio/job-watchdog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const doneStates = new Set(["completed", "complete", "finished", "done", "success", "succeeded"]);

function normalizeStatus(data: Record<string, unknown>) {
  return String(data.status ?? data.state ?? "processing").toLowerCase();
}

function normalizeProgress(data: Record<string, unknown>) {
  const progressValue = Number(data.progress ?? data.percent ?? data.percentage ?? 0);
  return Number.isFinite(progressValue)
    ? Math.max(0, Math.min(100, progressValue))
    : 0;
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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId")?.trim();

    if (!jobId) {
      return NextResponse.json({ error: "Falta jobId." }, { status: 400 });
    }

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
    const watchdog = evaluateRigJobWatchdog({ status, data });

    if (watchdog.expired) {
      return NextResponse.json(timeoutPayload({ jobId, progress, data, watchdog }), {
        headers: { "Cache-Control": "private, no-store" },
      });
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

    return NextResponse.json(
      {
        ok: true,
        jobId,
        status,
        progress,
        stage: data.stage ?? data.step ?? data.message ?? null,
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
    const timedOut = error instanceof Error && error.name === "AbortError";
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
