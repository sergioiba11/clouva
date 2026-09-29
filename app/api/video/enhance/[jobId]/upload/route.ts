import { NextRequest, NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";
import { generatedMediaBucketName } from "@/lib/gcs-media";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";
import { getVideoEnhanceJob, toPublicVideoEnhance, type VideoEnhanceRow } from "@/lib/server/video-enhance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;
const CHUNK_BYTES = 8 * 1024 * 1024;
const VIDEO_MIME = new Set(["video/mp4", "video/quicktime", "video/webm"]);
let storage: Storage | null = null;
function getStorage() { storage ??= new Storage(); return storage; }

function validate(body: Record<string, unknown>) {
  const filename = String(body.filename || "").trim();
  const size = Number(body.size || 0);
  const contentType = String(body.contentType || "").trim().toLowerCase();
  if (!filename) throw new MediaApiError("Falta el nombre del video.", 400, "video_filename_required");
  if (!Number.isFinite(size) || size <= 0) throw new MediaApiError("El video está vacío.", 400, "video_empty");
  if (size > MAX_VIDEO_BYTES) throw new MediaApiError("El video supera 4 GB.", 413, "video_too_large");
  if (!VIDEO_MIME.has(contentType)) throw new MediaApiError("Usá MP4, MOV o WebM.", 415, "invalid_video_type");
  return { filename, size, contentType };
}
function extension(filename: string, contentType: string) {
  const ext = filename.toLowerCase().match(/\.(mp4|mov|webm)$/)?.[1];
  if (ext) return ext;
  if (contentType === "video/quicktime") return "mov";
  if (contentType === "video/webm") return "webm";
  return "mp4";
}

function prefix(userId: string, jobId: string) {
  return `video-enhance/${userId}/${jobId}/input/`;
}

export async function POST(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { jobId } = await context.params;
    const job = await getVideoEnhanceJob(admin, jobId, user.id);
    if (!job) throw new MediaApiError("El trabajo no existe.", 404, "enhance_not_found");
    if (!["draft", "failed"].includes(job.status)) throw new MediaApiError("El trabajo ya está en ejecución.", 409, "enhance_locked");
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const input = validate(body);
    const objectPath = `${prefix(user.id, job.id)}${crypto.randomUUID()}.${extension(input.filename, input.contentType)}`;
    const [uploadUrl] = await getStorage().bucket(generatedMediaBucketName()).file(objectPath).createResumableUpload({
      metadata: {
        contentType: input.contentType,
        cacheControl: "private, max-age=0, no-store",
        metadata: {
          clouvaVideoEnhanceJobId: job.id,
          clouvaOwnerUserId: user.id,
          originalFilename: input.filename.slice(0, 240),
          expectedSize: String(input.size),
        },
      },
      origin: request.headers.get("origin") ?? request.nextUrl.origin,
    });
    return NextResponse.json({ uploadUrl, storagePath: objectPath, chunkBytes: CHUNK_BYTES, maxBytes: MAX_VIDEO_BYTES }, { status: 201 });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { jobId } = await context.params;
    const job = await getVideoEnhanceJob(admin, jobId, user.id);
    if (!job) throw new MediaApiError("El trabajo no existe.", 404, "enhance_not_found");
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const input = validate(body);
    const objectPath = String(body.storagePath || "").trim();
    if (!objectPath.startsWith(prefix(user.id, job.id)) || objectPath.includes("..")) {
      throw new MediaApiError("El video no pertenece a este trabajo.", 403, "invalid_video_path");
    }
    const file = getStorage().bucket(generatedMediaBucketName()).file(objectPath);
    const [exists] = await file.exists();
    if (!exists) throw new MediaApiError("El video todavía no terminó de subir.", 409, "video_not_uploaded");
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size || 0) !== input.size) throw new MediaApiError("El tamaño subido no coincide.", 409, "video_size_mismatch");
    const custom = metadata.metadata ?? {};
    if (custom.clouvaVideoEnhanceJobId !== job.id || custom.clouvaOwnerUserId !== user.id) {
      throw new MediaApiError("El video subido no pertenece a este trabajo.", 403, "video_owner_mismatch");
    }
    const sourceUrl = `https://storage.googleapis.com/${generatedMediaBucketName()}/${objectPath}`;
    const { data, error } = await admin.from("video_enhance_jobs").update({
      source_storage_path: objectPath,
      source_url: sourceUrl,
      source_filename: input.filename.slice(0, 240),
      source_size_bytes: input.size,
      status: "draft",
      progress: 0,
      error_code: null,
      error_message: null,
    }).eq("id", job.id).eq("user_id", user.id).select("*").single();
    if (error || !data) throw new MediaApiError("No se pudo vincular el video.", 500, "video_link_failed");
    return NextResponse.json({ job: toPublicVideoEnhance(data as unknown as VideoEnhanceRow) });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
