import { NextRequest, NextResponse } from "next/server";
import { enqueueVideoProjectStep } from "@/lib/server/cloud-tasks";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";
import { getVideoProject, listVideoProjectJobs, toPublicVideoProject, type VideoProjectRow } from "@/lib/server/video-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { projectId } = await context.params;
    const project = await getVideoProject(admin, projectId, user.id);
    if (!project) return NextResponse.json({ error: "El proyecto no existe.", code: "project_not_found" }, { status: 404 });
    if (!["draft", "failed"].includes(project.status)) {
      throw new MediaApiError("Este proyecto ya está en ejecución.", 409, "project_already_running");
    }
    const clips = await listVideoProjectJobs(admin, project.id);
    if (!clips.length) throw new MediaApiError("Primero generá el plan de clips.", 409, "clip_plan_required");
    if (project.project_mode === "visualizer" && project.audio_analysis_status !== "completed") {
      throw new MediaApiError("El visualizer necesita terminar de analizar el flow del audio antes de generar.", 409, "audio_analysis_required");
    }

    const body = await request.json().catch(() => ({})) as { confirmedCostUsd?: number };
    const expected = Number(project.estimated_cost_usd ?? 0);
    if (!Number.isFinite(body.confirmedCostUsd) || Math.abs(Number(body.confirmedCostUsd) - expected) > 0.001) {
      throw new MediaApiError("Confirmá el costo estimado del proyecto antes de generar.", 409, "cost_confirmation_required");
    }

    const now = new Date().toISOString();
    const { data, error } = await admin.from("video_projects").update({
      status: "queued",
      progress: 0,
      cost_confirmed_at: now,
      started_at: project.started_at ?? now,
      error_code: null,
      error_message: null,
    }).eq("id", project.id).eq("user_id", user.id).select("id").single();
    if (error || !data) throw new MediaApiError("No se pudo iniciar el proyecto.", 500, "project_start_failed");

    await enqueueVideoProjectStep(project.id, 0);
    const refreshed = await getVideoProject(admin, project.id, user.id);
    return NextResponse.json({ project: toPublicVideoProject(refreshed as VideoProjectRow) }, { status: 202 });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
