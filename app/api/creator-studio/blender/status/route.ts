import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const doneStates = new Set(["completed", "complete", "finished", "done", "success", "succeeded"]);

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

    const response = await fetch(
      `${workerUrl.replace(/\/$/, "")}/jobs/${encodeURIComponent(jobId)}`,
      {
        method: "GET",
        headers: workerToken
          ? { Authorization: `Bearer ${workerToken}` }
          : undefined,
        cache: "no-store",
      },
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "No se pudo consultar el estado del Auto Rig.",
          status: response.status,
          details: data,
        },
        { status: response.status },
      );
    }

    const status = String(data.status ?? data.state ?? "processing").toLowerCase();
    const progressValue = Number(data.progress ?? data.percent ?? data.percentage ?? 0);
    const progress = Number.isFinite(progressValue)
      ? Math.max(0, Math.min(100, progressValue))
      : 0;
    const workerHasResult = Boolean(data.resultUrl ?? data.outputUrl ?? data.downloadUrl);
    const resultUrl = workerHasResult || doneStates.has(status)
      ? `/api/creator-studio/blender/result?jobId=${encodeURIComponent(jobId)}`
      : null;

    return NextResponse.json({
      ok: true,
      jobId,
      status,
      progress,
      stage: data.stage ?? data.step ?? data.message ?? null,
      resultUrl,
      error: data.error ?? data.failureReason ?? null,
      riggingStrategy: data.riggingStrategy ?? null,
      templateMode: Boolean(data.templateMode),
      raw: data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Error inesperado al consultar el Auto Rig.",
      },
      { status: 500 },
    );
  }
}
