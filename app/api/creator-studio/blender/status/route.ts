import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    return NextResponse.json({
      ok: true,
      jobId,
      status,
      progress,
      stage: data.stage ?? data.step ?? data.message ?? null,
      resultUrl: data.resultUrl ?? data.outputUrl ?? data.downloadUrl ?? null,
      error: data.error ?? data.failureReason ?? null,
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
