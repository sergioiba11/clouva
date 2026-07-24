import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMultiImageTask, type MeshyTask } from "@/lib/meshy";
import { AVATAR_REFERENCE_ORDER } from "@/lib/avatar-triptych";

export const MAX_AVATAR_GLB_BYTES = 25 * 1024 * 1024;

export class AvatarGenerationError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "AvatarGenerationError";
    this.status = status;
  }
}

type JsonRecord = Record<string, unknown>;

type DownloadedGlb = {
  bytes: Buffer;
  sha256: string;
  sizeBytes: number;
  remoteUrl: string;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function remoteTaskError(task: MeshyTask) {
  if (typeof task.error === "string") return task.error;
  return task.task_error?.message || task.error?.message || `Meshy terminó con estado ${task.status}`;
}

async function downloadGlb(remoteUrl: string, label: string): Promise<DownloadedGlb> {
  let parsed: URL;
  try {
    parsed = new URL(remoteUrl);
  } catch {
    throw new AvatarGenerationError(`${label}: Meshy devolvió una URL inválida`, 502);
  }
  if (parsed.protocol !== "https:") {
    throw new AvatarGenerationError(`${label}: Meshy devolvió una URL no segura`, 502);
  }

  const response = await fetch(parsed, { redirect: "follow", cache: "no-store" });
  if (!response.ok) {
    throw new AvatarGenerationError(`${label}: no se pudo descargar el GLB de Meshy (${response.status})`, 502);
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_AVATAR_GLB_BYTES) {
    throw new AvatarGenerationError(`${label}: el GLB supera el límite permanente de 25 MB del bucket avatars`, 413);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_AVATAR_GLB_BYTES) {
    throw new AvatarGenerationError(`${label}: el GLB supera el límite permanente de 25 MB del bucket avatars`, 413);
  }
  if (bytes.subarray(0, 4).toString("ascii") !== "glTF") {
    throw new AvatarGenerationError(`${label}: Meshy no devolvió un GLB válido`, 422);
  }

  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
    remoteUrl,
  };
}

export async function finalizePendingAvatarGeneration(
  supabase: SupabaseClient,
  userId: string,
  meshyTaskId: string,
) {
  const { data: pendingAvatar, error: pendingError } = await supabase
    .from("user_avatars")
    .select("id,user_id,name,source,status,model_url,storage_path,preview_image_url,meshy_task_id,is_active,front_rotation_y,metadata,created_at,updated_at")
    .eq("user_id", userId)
    .eq("meshy_task_id", meshyTaskId)
    .maybeSingle();

  if (pendingError) throw new AvatarGenerationError(pendingError.message, 500);
  if (!pendingAvatar) throw new AvatarGenerationError("La tarea de Meshy no pertenece a un avatar pendiente de este usuario", 404);

  if (pendingAvatar.status === "pending_analysis" && pendingAvatar.model_url) {
    return pendingAvatar;
  }
  if (pendingAvatar.status !== "generating") {
    throw new AvatarGenerationError(`El avatar no está pendiente de generación (${pendingAvatar.status})`, 409);
  }

  const task = await getMultiImageTask(meshyTaskId);
  if (task.status !== "SUCCEEDED") {
    const terminal = ["FAILED", "EXPIRED", "CANCELED"].includes(task.status);
    throw new AvatarGenerationError(
      terminal ? remoteTaskError(task) : `Meshy todavía está procesando el avatar (${task.status})`,
      terminal ? 422 : 409,
    );
  }
  if (!task.model_urls?.glb) {
    throw new AvatarGenerationError("Meshy marcó la tarea como terminada pero no devolvió model_urls.glb", 502);
  }

  const mainGlb = await downloadGlb(task.model_urls.glb, "GLB principal");
  const preRemeshedGlb = task.model_urls.pre_remeshed_glb
    ? await downloadGlb(task.model_urls.pre_remeshed_glb, "GLB pre-remesh")
    : null;

  const mainStoragePath = `${userId}/${pendingAvatar.id}/source/avatar-meshy.glb`;
  const preRemeshedStoragePath = preRemeshedGlb
    ? `${userId}/${pendingAvatar.id}/source/avatar-pre-remeshed.glb`
    : null;
  const bucket = supabase.storage.from("avatars");
  const uploadedPaths: string[] = [];

  try {
    const { error: mainUploadError } = await bucket.upload(mainStoragePath, mainGlb.bytes, {
      contentType: "model/gltf-binary",
      cacheControl: "31536000",
      upsert: false,
    });
    if (mainUploadError) throw new AvatarGenerationError(mainUploadError.message, 500);
    uploadedPaths.push(mainStoragePath);

    if (preRemeshedGlb && preRemeshedStoragePath) {
      const { error: preUploadError } = await bucket.upload(preRemeshedStoragePath, preRemeshedGlb.bytes, {
        contentType: "model/gltf-binary",
        cacheControl: "31536000",
        upsert: false,
      });
      if (preUploadError) throw new AvatarGenerationError(preUploadError.message, 500);
      uploadedPaths.push(preRemeshedStoragePath);
    }

    const { data: mainPublicData } = bucket.getPublicUrl(mainStoragePath);
    const mainPublicUrl = mainPublicData.publicUrl;
    const preRemeshedPublicUrl = preRemeshedStoragePath
      ? bucket.getPublicUrl(preRemeshedStoragePath).data.publicUrl
      : null;
    const now = new Date().toISOString();
    const previousMetadata = asRecord(pendingAvatar.metadata);

    const metadata = {
      ...previousMetadata,
      generation_kind: "triptych-multi-image",
      reference_order: [...AVATAR_REFERENCE_ORDER],
      meshy_task_id: meshyTaskId,
      analyzer_status: "not_started",
      timestamp: now,
      generated_at: now,
      glb_sha256: mainGlb.sha256,
      glb_size_bytes: mainGlb.sizeBytes,
      permanent_glb_path: mainStoragePath,
      permanent_glb_url: mainPublicUrl,
      pre_remeshed_sha256: preRemeshedGlb?.sha256 ?? null,
      pre_remeshed_size_bytes: preRemeshedGlb?.sizeBytes ?? null,
      permanent_pre_remeshed_path: preRemeshedStoragePath,
      permanent_pre_remeshed_url: preRemeshedPublicUrl,
      meshy_remote_urls: {
        temporary: true,
        glb: mainGlb.remoteUrl,
        pre_remeshed_glb: preRemeshedGlb?.remoteUrl ?? null,
        thumbnail_url: task.thumbnail_url ?? null,
        thumbnail_urls: task.thumbnail_urls ?? null,
      },
    };

    const { data: avatar, error: saveError } = await supabase
      .from("user_avatars")
      .update({
        status: "pending_analysis",
        model_url: mainPublicUrl,
        storage_path: mainStoragePath,
        is_active: false,
        metadata,
        updated_at: now,
      })
      .eq("id", pendingAvatar.id)
      .eq("user_id", userId)
      .eq("meshy_task_id", meshyTaskId)
      .select("id,user_id,name,source,status,model_url,storage_path,preview_image_url,meshy_task_id,is_active,front_rotation_y,metadata,created_at,updated_at")
      .single();

    if (saveError || !avatar) {
      throw new AvatarGenerationError(saveError?.message || "No se pudo guardar el avatar pendiente de análisis", 500);
    }

    return avatar;
  } catch (error) {
    if (uploadedPaths.length) await bucket.remove(uploadedPaths);
    throw error;
  }
}
