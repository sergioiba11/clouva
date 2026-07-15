import { NextResponse } from "next/server";

export const runtime = "nodejs";

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
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as BlenderRequest;
    const workerUrl = process.env.BLENDER_WORKER_URL;
    const workerToken = process.env.BLENDER_WORKER_TOKEN;

    const job = {
      type: "clouva_creator_pipeline",
      avatarRig: payload.rig ?? "clouva_base_v1",
      category: payload.category ?? "accessory",
      sourceUrl: payload.sourceUrl ?? null,
      options: {
        cleanGeometry: true,
        repairNormals: true,
        applyTransforms: true,
        centerModel: true,
        fitToAvatar: true,
        shrinkwrap: true,
        transferSkinWeights: payload.autoWeight ?? true,
        transferVertexGroups: true,
        attachArmature: true,
        removeClipping: payload.autoFix ?? true,
        animationTests: ["idle", "walk", "run"],
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

    if (!workerUrl) {
      return NextResponse.json({
        ok: true,
        mock: true,
        jobId: `blender_preview_${Date.now()}`,
        status: "PENDING_CONFIGURATION",
        pipeline: job,
        message: "El panel está instalado. Agregá BLENDER_WORKER_URL en Vercel para conectar Railway.",
      });
    }

    const response = await fetch(`${workerUrl.replace(/\/$/, "")}/jobs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
      },
      body: JSON.stringify(job),
      cache: "no-store",
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: "El Blender Worker rechazó el trabajo.", details: data }, { status: response.status });
    }

    return NextResponse.json({
      ok: true,
      mock: false,
      jobId: data.jobId ?? data.id,
      status: data.status ?? "queued",
      raw: data,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error inesperado al conectar con Blender Worker." }, { status: 500 });
  }
}
