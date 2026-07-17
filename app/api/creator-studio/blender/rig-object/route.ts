import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const category = String(form.get("category") ?? "accessory");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Falta el GLB del objeto." }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".glb")) {
      return NextResponse.json({ error: "El archivo debe ser .glb." }, { status: 400 });
    }

    const workerUrl = process.env.GARMENT_WORKER_URL ?? process.env.BLENDER_WORKER_URL ?? "https://rig.clouva.com.ar";
    const workerToken = process.env.GARMENT_WORKER_TOKEN ?? process.env.BLENDER_WORKER_TOKEN;

    const workerForm = new FormData();
    workerForm.set("file", file, file.name);
    workerForm.set("job", JSON.stringify({ category }));

    const response = await fetch(`${workerUrl.replace(/\/$/, "")}/rig-object`, {
      method: "POST",
      headers: workerToken ? { Authorization: `Bearer ${workerToken}` } : undefined,
      body: workerForm,
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
        error: typeof data.detail === "string" ? data.detail : "El Garment Worker rechazó el rigeo del objeto.",
        status: response.status,
        details: data,
      }, { status: response.status });
    }

    return NextResponse.json({
      ok: true,
      jobId: data.jobId ?? data.id,
      status: data.status ?? "queued",
      category,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Error inesperado al rigear el objeto.",
    }, { status: 500 });
  }
}
