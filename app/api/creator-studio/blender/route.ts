import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { buildBlenderJob, type BlenderRequest } from "@/lib/creator-studio/blender-job";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFORMABLE_CATEGORIES = new Set(["hoodie", "shirt", "jacket", "pants", "shorts", "shoes"]);

function workerErrorMessage(data: Record<string, unknown>, status: number) {
  const detail = data.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (detail && typeof detail === "object") {
    const object = detail as Record<string, unknown>;
    if (typeof object.message === "string" && object.message.trim()) return object.message;
    try { return JSON.stringify(object); } catch { /* ignore */ }
  }
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  if (typeof data.error === "string" && data.error.trim()) return data.error;
  return `El Garment/Blender Worker rechazó el trabajo (HTTP ${status}).`;
}

function enforceCanonicalDeformableRig(payload: BlenderRequest): BlenderRequest {
  const category = String(payload.category ?? "").trim().toLowerCase();
  if (!DEFORMABLE_CATEGORIES.has(category)) return payload;

  // Cada intento parte del GLB original y de una escena Blender --factory-startup. El avatar
  // oficial se convierte a Rest Position y a un único espacio métrico antes de crear pesos.
  return {
    ...payload,
    autoWeight: true,
    templateMode: false,
    preserveExistingSkinning: false,
    forceFreshSource: true,
    previewSettings: {
      ...(payload.previewSettings ?? {}),
      rigProfileVersion: 16,
      forceWeightTransfer: true,
      validationContract: "canonical-rest-bind-v43",
      canonicalBindVersion: 43,
      restPoseBeforeMold: true,
      rejectPostSkinScaleChanges: true,
    },
  };
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    let payload: BlenderRequest;
    let sourceFile: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const rawPayload = form.get("payload");
      payload = rawPayload ? JSON.parse(String(rawPayload)) as BlenderRequest : {};
      const candidate = form.get("file");
      sourceFile = candidate instanceof File ? candidate : null;
      if (!sourceFile || sourceFile.size === 0) {
        return NextResponse.json({ error: "Falta el GLB real de referencia." }, { status: 400 });
      }
      if (!sourceFile.name.toLowerCase().endsWith(".glb")) {
        return NextResponse.json({ error: "El archivo debe ser .glb." }, { status: 400 });
      }
      if (sourceFile.size > 80 * 1024 * 1024) {
        return NextResponse.json({ error: "El GLB supera 80 MB." }, { status: 413 });
      }

      const bytes = new Uint8Array(await sourceFile.slice(0, 4).arrayBuffer());
      const magic = String.fromCharCode(...bytes);
      if (magic !== "glTF") {
        return NextResponse.json({ error: "El archivo no contiene un encabezado GLB válido." }, { status: 400 });
      }
    } else {
      payload = (await request.json()) as BlenderRequest;
    }

    payload = enforceCanonicalDeformableRig({
      ...payload,
      attemptId: randomUUID(),
      forceFreshSource: true,
    });

    const workerUrl = process.env.GARMENT_WORKER_URL ?? process.env.BLENDER_WORKER_URL ?? "https://rig.clouva.com.ar";
    const workerToken = process.env.GARMENT_WORKER_TOKEN ?? process.env.BLENDER_WORKER_TOKEN;
    const job = buildBlenderJob(payload);

    let response: Response;
    if (sourceFile) {
      const workerForm = new FormData();
      // File is immutable here: every POST, including “Reintentar molde automático”, sends
      // the original bytes again under a new attemptId instead of reusing a partial result.
      workerForm.set("file", sourceFile, sourceFile.name);
      workerForm.set("job", JSON.stringify(job));
      response = await fetch(`${workerUrl.replace(/\/$/, "")}/jobs`, {
        method: "POST",
        headers: workerToken ? { Authorization: `Bearer ${workerToken}` } : undefined,
        body: workerForm,
        cache: "no-store",
      });
    } else {
      response = await fetch(`${workerUrl.replace(/\/$/, "")}/jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
        },
        body: JSON.stringify(job),
        cache: "no-store",
      });
    }

    const rawText = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = rawText ? JSON.parse(rawText) as Record<string, unknown> : {};
    } catch {
      data = { message: rawText };
    }

    if (!response.ok) {
      const message = workerErrorMessage(data, response.status);
      return NextResponse.json({
        error: message,
        summary: "El Garment/Blender Worker rechazó el trabajo.",
        status: response.status,
        workerUrl,
        attemptId: job.attemptId,
        riggingStrategy: job.riggingStrategy,
        details: data,
      }, { status: response.status });
    }

    const returnedJobId = data.jobId ?? data.id;
    const workerReturnedResult = data.resultUrl ?? data.outputUrl;
    const proxiedResultUrl = workerReturnedResult && returnedJobId
      ? `/api/creator-studio/blender/result?jobId=${encodeURIComponent(String(returnedJobId))}`
      : workerReturnedResult ?? null;

    return NextResponse.json({
      ok: true,
      mock: false,
      workerUrl,
      attemptId: job.attemptId,
      sourcePolicy: job.sourcePolicy,
      canonicalBindVersion: 43,
      riggingStrategy: job.riggingStrategy,
      templateMode: job.templateMode,
      jobId: returnedJobId,
      status: data.status ?? "queued",
      resultUrl: proxiedResultUrl,
      message: data.message ?? "El trabajo fue enviado al Garment Worker.",
      raw: data,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Error inesperado al conectar con Garment/Blender Worker.",
      workerUrl: process.env.GARMENT_WORKER_URL ?? process.env.BLENDER_WORKER_URL ?? "https://rig.clouva.com.ar",
    }, { status: 500 });
  }
}
