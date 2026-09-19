import { NextRequest, NextResponse } from "next/server";
import { uploadGeneratedMediaObject } from "@/lib/gcs-media";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";
import { getVideoProject, toPublicVideoProject, type VideoProjectRow } from "@/lib/server/video-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_AUDIO_BYTES = 250 * 1024 * 1024;
const AUDIO_MIME = new Set([
  "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/flac", "audio/aac",
]);

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { projectId } = await context.params;
    const project = await getVideoProject(admin, projectId, user.id);
    if (!project) return NextResponse.json({ error: "El proyecto no existe.", code: "project_not_found" }, { status: 404 });
    if (!["draft", "failed"].includes(project.status)) {
      throw new MediaApiError("El audio no puede cambiar mientras el proyecto está ejecutándose.", 409, "project_locked");
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new MediaApiError("Elegí el audio master.", 400, "audio_required");
    if (!AUDIO_MIME.has(file.type)) {
      throw new MediaApiError("Usá WAV, MP3, M4A, AAC o FLAC.", 415, "invalid_audio_type");
    }
    if (file.size <= 0 || file.size > MAX_AUDIO_BYTES) {
      throw new MediaApiError("El audio master debe pesar hasta 250 MB.", 413, "audio_too_large");
    }

    const stored = await uploadGeneratedMediaObject({
      bytes: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
      pathPrefix: `video-projects/${user.id}/${project.id}/inputs/audio`,
    });

    const { data, error } = await admin.from("video_projects").update({
      audio_storage_path: stored.objectPath,
      audio_url: stored.url,
    }).eq("id", project.id).eq("user_id", user.id).select("id").single();
    if (error || !data) throw new MediaApiError("No se pudo vincular el audio al proyecto.", 500, "audio_link_failed");

    const refreshed = await getVideoProject(admin, project.id, user.id);
    return NextResponse.json({ project: toPublicVideoProject(refreshed as VideoProjectRow) });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
