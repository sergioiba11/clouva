import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { riggedObjectJobId?: string; category?: string; side?: string };
    if (!payload.riggedObjectJobId) {
      return NextResponse.json({ error: "Falta riggedObjectJobId (el resultado del paso 'Rigear objeto')." }, { status: 400 });
    }

    const workerUrl = process.env.GARMENT_WORKER_URL ?? process.env.BLENDER_WORKER_URL ?? "https://rig.clouva.com.ar";
    const workerToken = process.env.GARMENT_WORKER_TOKEN ?? process.env.BLENDER_WORKER_TOKEN;

    const response = await fetch(`${workerUrl.replace(/\/$/, "")}/attach-object`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
      },
      body: JSON.stringify({
        riggedObjectJobId: payload.riggedObjectJobId,
        category: payload.category ?? "accessory",
        side: payload.side ?? "right",
      }),
      cache: "no-store",
    });

    const rawText = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = rawText ? JSON.parse(rawText) as Record<string, unknown> : {};
    } catch {
      data = { message: rawText };
    }

    if (!response.ok) {
      return NextResponse.json({
        error: typeof data.detail === "string" ? data.detail : "El Garment Worker rechazó la unión con el avatar.",
        status: response.status,
        details: data,
      }, { status: response.status });
    }

    return NextResponse.json({
      ok: true,
      jobId: data.jobId ?? data.id,
      status: data.status ?? "queued",
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Error inesperado al unir el objeto con el avatar.",
    }, { status: 500 });
  }
}
