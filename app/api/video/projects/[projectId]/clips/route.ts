import { NextRequest, NextResponse } from "next/server";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";
import {
  createVideoProjectClipPlan,
  getVideoProject,
  listVideoProjectJobs,
  toPublicVideoProjectJob,
  type VideoProjectFrame,
} from "@/lib/server/video-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function frame(value: unknown): VideoProjectFrame | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const url = typeof item.url === "string" ? item.url.trim() : "";
  if (!url || (!url.startsWith("https://storage.googleapis.com/") && !url.startsWith("gs://"))) return null;
  return {
    url,
    storagePath: typeof item.storagePath === "string" ? item.storagePath : null,
    mimeType: typeof item.mimeType === "string" ? item.mimeType : null,
  };
}

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { projectId } = await context.params;
    const project = await getVideoProject(admin, projectId, user.id);
    if (!project) return NextResponse.json({ error: "El proyecto no existe.", code: "project_not_found" }, { status: 404 });
    const clips = await listVideoProjectJobs(admin, project.id);
    return NextResponse.json({ clips: clips.map(toPublicVideoProjectJob) });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { projectId } = await context.params;
    const project = await getVideoProject(admin, projectId, user.id);
    if (!project) return NextResponse.json({ error: "El proyecto no existe.", code: "project_not_found" }, { status: 404 });

    const body = await request.json().catch(() => ({})) as { frames?: unknown[] };
    const frames = Array.isArray(body.frames) ? body.frames.map(frame).filter((item): item is VideoProjectFrame => Boolean(item)).slice(0, 60) : [];
    if (!project.master_prompt.trim() && !frames.length) {
      throw new MediaApiError("Agregá un prompt o al menos un frame para crear el plan.", 400, "project_input_required");
    }
    const clips = await createVideoProjectClipPlan({ admin, project, frames });
    const refreshed = await getVideoProject(admin, project.id, user.id);
    return NextResponse.json({
      project: refreshed ? {
        id: refreshed.id,
        status: refreshed.status,
        estimatedCostUsd: refreshed.estimated_cost_usd,
      } : null,
      clips: clips.map(toPublicVideoProjectJob),
    });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}


export async function PATCH(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { projectId } = await context.params;
    const project = await getVideoProject(admin, projectId, user.id);
    if (!project) return NextResponse.json({ error: "El proyecto no existe.", code: "project_not_found" }, { status: 404 });
    if (!["draft", "failed"].includes(project.status)) {
      throw new MediaApiError("El timeline no puede reordenarse mientras el proyecto está ejecutándose.", 409, "project_locked");
    }

    const current = await listVideoProjectJobs(admin, project.id);
    const body = await request.json().catch(() => ({})) as { clipIds?: unknown[] };
    const clipIds = Array.isArray(body.clipIds)
      ? body.clipIds.filter((value): value is string => typeof value === "string")
      : [];
    const currentIds = current.map((clip) => clip.id);
    if (
      clipIds.length !== currentIds.length
      || new Set(clipIds).size !== clipIds.length
      || clipIds.some((id) => !currentIds.includes(id))
    ) {
      throw new MediaApiError("El orden enviado no coincide con los clips del proyecto.", 400, "invalid_clip_order");
    }

    // The sequence index has a unique project constraint. Move every row to a
    // temporary negative range first, then assign the definitive order.
    for (let index = 0; index < clipIds.length; index += 1) {
      const { error } = await admin
        .from("media_generation_jobs")
        .update({ sequence_index: -100000 - index })
        .eq("id", clipIds[index])
        .eq("project_id", project.id)
        .eq("user_id", user.id);
      if (error) throw new Error(`No se pudo reservar el orden temporal: ${error.message}`);
    }
    for (let index = 0; index < clipIds.length; index += 1) {
      const { error } = await admin
        .from("media_generation_jobs")
        .update({ sequence_index: index })
        .eq("id", clipIds[index])
        .eq("project_id", project.id)
        .eq("user_id", user.id);
      if (error) throw new Error(`No se pudo guardar el nuevo orden: ${error.message}`);
    }

    const clips = await listVideoProjectJobs(admin, project.id);
    return NextResponse.json({ clips: clips.map(toPublicVideoProjectJob) });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
