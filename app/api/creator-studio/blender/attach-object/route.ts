import { NextResponse } from "next/server";
import { REFERENCE_CATEGORIES, type ReferenceCategory } from "@/lib/creator-studio/reference-assets";
import { resolveRigProfile } from "@/lib/creator-studio/rig-profiles";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { riggedObjectJobId?: string; category?: string; side?: string };
    if (!payload.riggedObjectJobId) {
      return NextResponse.json({ error: "Falta riggedObjectJobId (el resultado del paso de rig rígido)." }, { status: 400 });
    }

    const rawCategory = String(payload.category ?? "").trim().toLowerCase();
    if (!REFERENCE_CATEGORIES.includes(rawCategory as ReferenceCategory)) {
      return NextResponse.json({ error: "La categoría del objeto no es válida." }, { status: 400 });
    }

    const category = rawCategory as ReferenceCategory;
    const profile = resolveRigProfile(category);
    if (profile.pipeline !== "object") {
      return NextResponse.json(
        {
          error: `${profile.label} debe compartir el armature completo del avatar mediante transferencia de pesos. No se puede unir como accesorio rígido.`,
          expectedPipeline: "garment",
          category,
        },
        { status: 409 },
      );
    }

    const side = payload.side === "left" ? "left" : "right";
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
        category,
        side,
        rigProfileVersion: 3,
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
      category,
      side,
      anchor: profile.anchor,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Error inesperado al unir el objeto con el avatar.",
    }, { status: 500 });
  }
}
