import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type BlenderRequest = {
  sourceUrl?: string;
  category?: string;
  rig?: string;
  autoFix?: boolean;
  autoWeight?: boolean;
  autoExport?: boolean;
  targetPolycount?: number;
  maxFileSizeMb?: number;
  textureResolution?: number;
  formats?: string[];
  previewSettings?: Record<string, unknown>;
  referenceAssetName?: string | null;
};

function buildJob(payload: BlenderRequest) {
  return {
    type: "clouva_creator_pipeline",
    operation: "fit_and_rig_reference",
    avatarRig: payload.rig ?? "clouva_base_v1",
    category: payload.category ?? "accessory",
    sourceUrl: payload.sourceUrl ?? null,
    referenceAssetName: payload.referenceAssetName ?? null,
    previewSettings: payload.previewSettings ?? {},
    options: {
      cleanGeometry: true,
      repairNormals: true,
      applyTransforms: true,
      centerModel: true,
      fitToAvatar: true,
      shrinkwrap: true,
      surfaceDeform: true,
      transferSkinWeights: payload.autoWeight ?? true,
      transferVertexGroups: true,
      attachArmature: true,
      preserveMaterials: true,
      removeClipping: payload.autoFix ?? true,
      animationTests: ["tpose", "idle", "walk", "run"],
      generateLod: true,
      targetPolycount: payload.targetPolycount ?? 25000,
      maxFileSizeMb: payload.maxFileSizeMb ?? 18,
      textureResolution: payload.textureResolution ?? 2048,
      compressMaterials: true,
      generateThumbnails: true,
      generateTurntable: true,
      formats: payload.formats ?? ["glb"],
      autoExport: payload.autoExport ?? true,
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
    } else {
      payload = (await request.json()) as BlenderRequest;
    }

    const workerUrl = process.env.BLENDER_WORKER_URL;
    const workerToken = process.env.BLENDER_WORKER_TOKEN;
    const job = buildJob(payload);

    if (!workerUrl) {
      return NextResponse.json({
        ok: true,
        mock: true,
        jobId: `blender_preview_${Date.now()}`,
        status: "PENDING_CONFIGURATION",
        pipeline: job,
        receivedFile: sourceFile ? { name: sourceFile.name, size: sourceFile.size } : null,
        message: "El auto rig ya está preparado en la app. Falta BLENDER_WORKER_URL en Vercel para ejecutar Blender en Railway.",
      });
    }

    let response: Response;
    if (sourceFile) {
      const workerForm = new FormData();
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

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: "El Blender Worker rechazó el trabajo.", details: data }, { status: response.status });
    }

    return NextResponse.json({
      ok: true,
      mock: false,
      jobId: data.jobId ?? data.id,
      status: data.status ?? "queued",
      resultUrl: data.resultUrl ?? data.outputUrl ?? null,
      raw: data,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error inesperado al conectar con Blender Worker." }, { status: 500 });
  }
}
