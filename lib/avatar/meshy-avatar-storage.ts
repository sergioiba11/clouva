import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MeshyTask } from "@/lib/meshy";

// The current Supabase avatars bucket is capped at 25 MiB per object.
export const MAX_AVATAR_SOURCE_GLB_BYTES = 25 * 1024 * 1024;
export const AVATAR_SOURCE_BUCKET = "avatars";

export type ValidatedGlb = {
  bytes: Buffer;
  sha256: string;
  remoteUrl: string;
};

export type StoredMeshyAvatarSources = {
  modelUrl: string;
  sourceStoragePath: string;
  sourceSha256: string;
  preRemeshedStoragePath: string | null;
  preRemeshedSha256: string | null;
};

function assertHttpsUrl(value: string, label: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} no tiene una URL válida`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${label} debe usar HTTPS`);
  return parsed;
}

export async function downloadAndValidateGlb(remoteUrl: string, label: string): Promise<ValidatedGlb> {
  const parsedUrl = assertHttpsUrl(remoteUrl, label);
  const remote = await fetch(parsedUrl, {
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  if (!remote.ok) throw new Error(`No se pudo descargar ${label} (${remote.status})`);

  const contentLength = Number(remote.headers.get("content-length") || 0);
  if (contentLength > MAX_AVATAR_SOURCE_GLB_BYTES) {
    throw new Error(`${label} supera el límite de 25 MB del bucket de avatares`);
  }

  const bytes = Buffer.from(await remote.arrayBuffer());
  if (bytes.byteLength > MAX_AVATAR_SOURCE_GLB_BYTES) {
    throw new Error(`${label} supera el límite de 25 MB del bucket de avatares`);
  }
  if (bytes.byteLength < 12 || bytes.subarray(0, 4).toString("ascii") !== "glTF") {
    throw new Error(`${label} no es un archivo GLB válido`);
  }

  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    remoteUrl,
  };
}

async function uploadImmutable(
  supabase: SupabaseClient,
  storagePath: string,
  source: ValidatedGlb,
) {
  const bucket = supabase.storage.from(AVATAR_SOURCE_BUCKET);
  const { error } = await bucket.upload(storagePath, source.bytes, {
    contentType: "model/gltf-binary",
    cacheControl: "31536000",
    upsert: false,
  });

  if (!error) return;

  const { data: existing, error: existingError } = await bucket.download(storagePath);
  if (!existingError && existing) {
    const existingBytes = Buffer.from(await existing.arrayBuffer());
    const existingSha256 = createHash("sha256").update(existingBytes).digest("hex");
    if (existingSha256 === source.sha256) return;
  }

  throw new Error(`No se pudo conservar la fuente inmutable del avatar: ${error.message}`);
}

export async function persistMeshyAvatarSources(args: {
  supabase: SupabaseClient;
  userId: string;
  avatarId: string;
  task: MeshyTask;
}): Promise<StoredMeshyAvatarSources> {
  const { supabase, userId, avatarId, task } = args;
  const mainUrl = task.model_urls?.glb;
  if (!mainUrl) throw new Error("Meshy terminó la tarea pero no devolvió el GLB principal");

  const main = await downloadAndValidateGlb(mainUrl, "el GLB principal de Meshy");
  const preRemeshedUrl = task.model_urls?.pre_remeshed_glb;
  const preRemeshed = preRemeshedUrl
    ? await downloadAndValidateGlb(preRemeshedUrl, "el GLB pre-remesh de Meshy")
    : null;

  const sourceStoragePath = `${userId}/${avatarId}/source/avatar-meshy.glb`;
  const preRemeshedStoragePath = preRemeshed
    ? `${userId}/${avatarId}/source/avatar-pre-remeshed.glb`
    : null;

  await uploadImmutable(supabase, sourceStoragePath, main);
  if (preRemeshed && preRemeshedStoragePath) {
    await uploadImmutable(supabase, preRemeshedStoragePath, preRemeshed);
  }

  const { data: publicData } = supabase.storage.from(AVATAR_SOURCE_BUCKET).getPublicUrl(sourceStoragePath);
  if (!publicData.publicUrl) throw new Error("No se pudo resolver la URL permanente del avatar");

  return {
    modelUrl: publicData.publicUrl,
    sourceStoragePath,
    sourceSha256: main.sha256,
    preRemeshedStoragePath,
    preRemeshedSha256: preRemeshed?.sha256 ?? null,
  };
}
