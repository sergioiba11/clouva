import { NextRequest, NextResponse } from "next/server";
import { runVideoAudioAnalysisJob } from "@/lib/cloud-run-jobs";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";
import { getVideoProject, toPublicVideoProject, type VideoProjectRow } from "@/lib/server/video-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { projectId } = await context.params;
    const project = await getVideoProject(admin, projectId, user.id);
    if (!project) return NextResponse.json({ error: "El proyecto no existe.", code: "project_not_found" }, { status: 404 });
    if (![ "draft", "failed" ].includes(project.status)) {
      throw new MediaApiError("El audio no puede analizarse mientras el proyecto está ejecutándose.", 409, "project_locked");
    }
    if (!project.audio_storage_path) {
      throw new MediaApiError("Subí el audio master antes de analizar el flow.", 409, "audio_required");
    }

    if ([ "queued", "analyzing" ].includes(project.audio_analysis_status)) {
      return NextResponse.json({ project: toPublicVideoProject(project) }, { status: 202 });
    }

    const { error: queueError } = await admin.from("video_projects").update({
      audio_analysis_status: "queued",
      audio_analysis: null,
      audio_analysis_error: null,
      audio_analysis_execution_name: null,
    }).eq("id", project.id).eq("user_id", user.id);
    if (queueError) throw new MediaApiError("No se pudo preparar el análisis del audio.", 500, "audio_analysis_queue_failed");

    try {
      const executionName = await runVideoAudioAnalysisJob(project.id);
      const { error: executionError } = await admin.from("video_projects").update({
        audio_analysis_execution_name: executionName,
      }).eq("id", project.id).eq("user_id", user.id);
      if (executionError) throw new Error("El análisis arrancó, pero no pudo registrarse la ejecución.");

      const refreshed = await getVideoProject(admin, project.id, user.id);
      return NextResponse.json({ project: toPublicVideoProject(refreshed as VideoProjectRow) }, { status: 202 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo iniciar el análisis del audio.";
      await admin.from("video_projects").update({
        audio_analysis_status: "failed",
        audio_analysis_error: message.slice(0, 800),
      }).eq("id", project.id).eq("user_id", user.id);
      throw error;
    }
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
