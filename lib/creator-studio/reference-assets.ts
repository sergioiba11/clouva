import { supabase } from "@/lib/supabase";

export const REFERENCE_CATEGORIES = [
  "hoodie", "remera", "campera", "baggy", "zapatillas", "gorra", "cadena",
  "lentes", "mochila", "aros", "guantes", "pulseras", "anillos",
] as const;

export type ReferenceCategory = (typeof REFERENCE_CATEGORIES)[number];

export type ReferenceAsset = {
  id: string;
  name: string;
  category: ReferenceCategory;
  fileName: string;
  size: number;
  createdAt: number;
  sourceUrl?: string;
  license?: string;
  author?: string;
  storagePath?: string;
  ownerId?: string;
  file: Blob;
};

const BUCKET = "creator-reference-assets";
const TABLE = "creator_reference_assets";

function sanitizeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "model.glb";
}

async function requireUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Iniciá sesión para usar tu biblioteca GLB.");
  return data.user.id;
}

export async function listReferenceAssets(): Promise<ReferenceAsset[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(TABLE)
    .select("id,user_id,name,category,file_name,file_size,storage_path,source_url,license,author,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`No se pudo leer la biblioteca online: ${error.message}`);

  const assets = await Promise.all((data ?? []).map(async (row: any) => {
    const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(row.storage_path);
    if (downloadError || !blob) {
      throw new Error(`No se pudo descargar ${row.name}: ${downloadError?.message ?? "archivo no disponible"}`);
    }
    return {
      id: row.id,
      ownerId: row.user_id,
      name: row.name,
      category: row.category as ReferenceCategory,
      fileName: row.file_name,
      size: Number(row.file_size ?? blob.size),
      createdAt: new Date(row.created_at).getTime(),
      sourceUrl: row.source_url ?? undefined,
      license: row.license ?? undefined,
      author: row.author ?? undefined,
      storagePath: row.storage_path,
      file: blob,
    } satisfies ReferenceAsset;
  }));

  return assets;
}

export async function saveReferenceAsset(asset: ReferenceAsset): Promise<void> {
  const userId = await requireUserId();
  const storagePath = `${userId}/${asset.id}/${sanitizeFileName(asset.fileName)}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, asset.file, {
      contentType: "model/gltf-binary",
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) throw new Error(`No se pudo subir el GLB: ${uploadError.message}`);

  const { error: insertError } = await supabase.from(TABLE).insert({
    id: asset.id,
    user_id: userId,
    name: asset.name,
    category: asset.category,
    file_name: asset.fileName,
    file_size: asset.size,
    storage_path: storagePath,
    source_url: asset.sourceUrl ?? null,
    license: asset.license ?? null,
    author: asset.author ?? null,
  });

  if (insertError) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw new Error(`No se pudo guardar el modelo en la base: ${insertError.message}`);
  }
}

export async function deleteReferenceAsset(id: string): Promise<void> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(TABLE)
    .select("storage_path")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`No se pudo localizar el GLB: ${error.message}`);
  if (!data) return;

  const { error: storageError } = await supabase.storage.from(BUCKET).remove([data.storage_path]);
  if (storageError) throw new Error(`No se pudo eliminar el archivo: ${storageError.message}`);

  const { error: deleteError } = await supabase.from(TABLE).delete().eq("id", id).eq("user_id", userId);
  if (deleteError) throw new Error(`No se pudo eliminar el registro: ${deleteError.message}`);
}

export function makeReferenceAsset(
  file: File,
  category: ReferenceCategory,
  metadata: Partial<Pick<ReferenceAsset, "name" | "sourceUrl" | "license" | "author">> = {},
): ReferenceAsset {
  return {
    id: crypto.randomUUID(),
    name: metadata.name?.trim() || file.name.replace(/\.glb$/i, ""),
    category,
    fileName: file.name,
    size: file.size,
    createdAt: Date.now(),
    sourceUrl: metadata.sourceUrl?.trim() || undefined,
    license: metadata.license?.trim() || undefined,
    author: metadata.author?.trim() || undefined,
    file,
  };
}
