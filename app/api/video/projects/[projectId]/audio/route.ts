import { NextRequest, NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";
import { generatedMediaBucketName } from "@/lib/gcs-media";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";
import { getVideoProject, toPublicVideoProject, type VideoProjectRow } from "@/lib/server/video-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 1024 * 1024 * 1024;
const AUDIO_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
const AUDIO_MIME = new Set([
  "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave", "audio/flac", "audio/aac",
]);

let storage: Storage | null = null;
function getStorage() {
  storage ??= new Storage();
  return storage;
}

function safeExtension(filename: string, contentType: string) {
  const fromName = filename.toLowerCase().match(/\.(mp3|m4a|wav|flac|aac)$/)?.[1];
  if (fromName) return fromName;
  const byMime: Record<string, string> = {
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/vnd.wave": "wav",
    "audio/flac": "flac",
    "audio/aac": "aac",
  };
  return byMime[contentType] ?? "audio";
}

function validateAudioInput(body: Record<string, unknown>) {
  const filename = typeof body.filename === "string" ? body.filename.trim() : "";
  const size = Number(body.size ?? 0);
  const contentType = typeof body.contentType === "string" ? body.contentType.trim().toLowerCase() : "";
  if (!filename) throw new MediaApiError("Falta el nombre del audio.", 400, "audio_filename_required");
  if (!Number.isFinite(size) || size <= 0) throw new MediaApiError("El audio está vacío.", 400, "audio_empty");
  if (size > MAX_AUDIO_BYTES) throw new MediaApiError("El audio master supera 1 GB.", 413, "audio_too_large");
  if (!AUDIO_MIME.has(contentType)) throw new MediaApiError("Usá WAV, MP3, M4A, AAC o FLAC.", 415, "invalid_audio_type");
  return { filename, size, contentType };
}

function expectedPrefix(userId: string, projectId: string) {
  return `video-projects/${userId}/${projectId}/inputs/audio/`;
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { projectId } = await context.params;
    const project = await getVideoProject(admin, projectId, user.id);
    if (!project) return NextResponse.json({ error: "El proyecto no existe.", code: "project_not_found" }, { status: 404 });
    if (!["draft", "failed"].includes(project.status)) {
      throw new MediaApiError("El audio no puede cambiar mientras el proyecto está ejecutándose.", 409, "project_locked");
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const { filename, size, contentType } = validateAudioInput(body);
    const objectPath = `${expectedPrefix(user.id, project.id)}${crypto.randomUUID()}.${safeExtension(filename, contentType)}`;
    const [uploadUrl] = await getStorage().bucket(generatedMediaBucketName()).file(objectPath).createResumableUpload({
      metadata: {
        contentType,
        cacheControl: "private, max-age=0, no-store",
        metadata: {
          clouvaVideoProjectId: project.id,
          clouvaOwnerUserId: user.id,
          originalFilename: filename.slice(0, 240),
          expectedSize: String(size),
        },
      },
      origin: request.headers.get("origin") ?? request.nextUrl.origin,
    });

    return NextResponse.json({
      uploadUrl,
      storagePath: objectPath,
      chunkBytes: AUDIO_UPLOAD_CHUNK_BYTES,
      maxBytes: MAX_AUDIO_BYTES,
    }, { status: 201 });
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
      throw new MediaApiError("El audio no puede cambiar mientras el proyecto está ejecutándose.", 409, "project_locked");
    }

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const { size, contentType } = validateAudioInput(body);
    const objectPath = typeof body.storagePath === "string" ? body.storagePath.trim() : "";
    if (!objectPath.startsWith(expectedPrefix(user.id, project.id)) || objectPath.includes("..")) {
      throw new MediaApiError("La ruta del audio no pertenece a este proyecto.", 403, "invalid_audio_path");
    }

    const file = getStorage().bucket(generatedMediaBucketName()).file(objectPath);
    const [exists] = await file.exists();
    if (!exists) throw new MediaApiError("El audio todavía no terminó de subir.", 409, "audio_not_uploaded");
    const [metadata] = await file.getMetadata();
    const storedSize = Number(metadata.size ?? 0);
    const storedType = String(metadata.contentType ?? "").toLowerCase();
    if (storedSize !== size) throw new MediaApiError("El tamaño del audio subido no coincide con el original.", 409, "audio_size_mismatch");
    if (storedType !== contentType || !AUDIO_MIME.has(storedType)) {
      throw new MediaApiError("El tipo del audio subido no coincide con el original.", 409, "audio_type_mismatch");
    }
    const custom = metadata.metadata ?? {};
    if (custom.clouvaVideoProjectId !== project.id || custom.clouvaOwnerUserId !== user.id) {
      throw new MediaApiError("El audio subido no pertenece a este proyecto.", 403, "audio_owner_mismatch");
    }

    const url = `https://storage.googleapis.com/${generatedMediaBucketName()}/${objectPath}`;
    const { data, error } = await admin.from("video_projects").update({
      audio_storage_path: objectPath,
      audio_url: url,
      audio_analysis_status: "idle",
      audio_analysis: null,
      audio_analysis_error: null,
      audio_analysis_execution_name: null,
    }).eq("id", project.id).eq("user_id", user.id).select("id").single();
    if (error || !data) throw new MediaApiError("No se pudo vincular el audio al proyecto.", 500, "audio_link_failed");

    const refreshed = await getVideoProject(admin, project.id, user.id);
    return NextResponse.json({ project: toPublicVideoProject(refreshed as VideoProjectRow) });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
