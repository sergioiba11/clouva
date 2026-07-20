import { supabase } from "@/lib/supabase";

export const REFERENCE_CATEGORIES = [
  "hoodie", "remera", "campera", "baggy", "zapatillas", "gorra", "cadena",
  "lentes", "mochila", "aros", "guantes", "pulseras", "anillos",
] as const;

export type ReferenceCategory = (typeof REFERENCE_CATEGORIES)[number];
export type ReferenceAssetStatus = "reference" | "processing" | "rigged" | "ready" | "error";

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
  riggedStoragePath?: string;
  previewSettings: Record<string, unknown>;
  status: ReferenceAssetStatus;
  isTemplate: boolean;
  isSource: boolean;
  sourceAssetId?: string;
  ownerId?: string;
  file: Blob;
};

const BUCKET = "creator-reference-assets";
const TABLE = "creator_reference_assets";
const SELECT_FIELDS = "id,user_id,name,category,file_name,file_size,storage_path,source_url,license,author,status,preview_settings,rigged_storage_path,created_at";

function sanitizeFileName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "model.glb";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isResultRow(row: any): boolean {
  const status = String(row?.status ?? "reference").toLowerCase();
  return (status === "rigged" || status === "ready") && Boolean(row?.rigged_storage_path);
}

async function requireUserId() {
  const sessionResult = await supabase.auth.getSession();
  if (sessionResult.error) throw sessionResult.error;
  if (sessionResult.data.session?.user) return sessionResult.data.session.user.id;

  return await new Promise<string>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      subscription.unsubscribe();
      reject(new Error("La sesión todavía no terminó de cargar. Recargá la página o iniciá sesión nuevamente."));
    }, 8000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) return;
      window.clearTimeout(timeout);
      subscription.unsubscribe();
      resolve(session.user.id);
    });
  });
}

async function rowToAsset(row: any): Promise<ReferenceAsset> {
  const result = isResultRow(row);
  const metadata = asRecord(row.preview_settings);
  const selectedStoragePath = result ? row.rigged_storage_path : row.storage_path;
  if (!selectedStoragePath) throw new Error("El GLB no tiene una ruta de Storage válida.");

  const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(selectedStoragePath);
  if (downloadError || !blob) throw new Error(downloadError?.message ?? "archivo no disponible");

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
    riggedStoragePath: result ? row.rigged_storage_path : undefined,
    previewSettings: result ? metadata : {},
    status: result ? String(row.status) as ReferenceAssetStatus : "reference",
    isTemplate: result,
    isSource: !result,
    sourceAssetId: typeof metadata.sourceAssetId === "string" ? metadata.sourceAssetId : undefined,
    file: blob,
  };
}

async function getOwnedRow(id: string, userId: string) {
  const { data, error } = await supabase
    .from(TABLE)
    .select(SELECT_FIELDS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo localizar el GLB: ${error.message}`);
  if (!data) throw new Error("El GLB original ya no existe en la biblioteca.");
  return data;
}

async function keepSourceClean(id: string, userId: string) {
  const row = await getOwnedRow(id, userId);
  if (isResultRow(row)) return;

  const { error } = await supabase.from(TABLE).update({
    status: "reference",
    preview_settings: {},
    updated_at: new Date().toISOString(),
  }).eq("id", id).eq("user_id", userId);
  if (error) throw new Error(`No se pudo conservar el GLB original: ${error.message}`);
}

async function saveResultCopy(
  sourceRow: any,
  sourceAssetId: string,
  userId: string,
  blob: Blob,
  previewSettings: Record<string, unknown>,
): Promise<ReferenceAsset> {
  const resultId = crypto.randomUUID();
  const attempt = Date.now().toString(36);
  const sourceFileName = sanitizeFileName(String(sourceRow.file_name || "model.glb"));
  const resultFileName = `rigged-${attempt}-${sourceFileName}`;
  const resultStoragePath = `${userId}/${resultId}/${resultFileName}`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(resultStoragePath, blob, {
    contentType: "model/gltf-binary",
    cacheControl: "3600",
    upsert: false,
  });
  if (uploadError) throw new Error(`No se pudo guardar el GLB riggeado: ${uploadError.message}`);

  const resultMetadata = {
    ...previewSettings,
    sourceAssetId,
    sourceAssetName: sourceRow.name,
    resultKind: "rigged-copy",
    savedAt: new Date().toISOString(),
  };
  const resultRow = {
    id: resultId,
    user_id: userId,
    name: `${sourceRow.name} · resultado riggeado`,
    category: sourceRow.category,
    file_name: resultFileName,
    file_size: blob.size,
    storage_path: resultStoragePath,
    rigged_storage_path: resultStoragePath,
    source_url: sourceRow.source_url ?? null,
    license: sourceRow.license ?? null,
    author: sourceRow.author ?? null,
    status: "ready",
    preview_settings: resultMetadata,
    created_at: new Date().toISOString(),
  };

  const { error: insertError } = await supabase.from(TABLE).insert(resultRow);
  if (insertError) {
    await supabase.storage.from(BUCKET).remove([resultStoragePath]);
    throw new Error(`El GLB se riggeó, pero no se pudo guardar como resultado separado: ${insertError.message}`);
  }

  await keepSourceClean(sourceAssetId, userId);
  return rowToAsset(resultRow);
}

export async function listReferenceAssets(): Promise<ReferenceAsset[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(TABLE)
    .select(SELECT_FIELDS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`No se pudo leer la biblioteca online: ${error.message}`);

  const results = await Promise.allSettled((data ?? []).map(rowToAsset));
  return results
    .flatMap((result) => result.status === "fulfilled" ? [result.value] : [])
    .sort((a, b) => Number(a.isTemplate) - Number(b.isTemplate) || b.createdAt - a.createdAt);
}

export async function getReferenceAssetById(id: string): Promise<ReferenceAsset | null> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(TABLE)
    .select(SELECT_FIELDS)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo recuperar el GLB: ${error.message}`);
  return data ? rowToAsset(data) : null;
}

export async function saveReferenceAsset(asset: ReferenceAsset): Promise<void> {
  const userId = await requireUserId();
  const storagePath = `${userId}/${asset.id}/${sanitizeFileName(asset.fileName)}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, asset.file, {
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
    status: "reference",
    preview_settings: {},
  });
  if (insertError) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw new Error(`No se pudo guardar el modelo en la base: ${insertError.message}`);
  }
}

export async function promoteReferenceAssetToTemplate(id: string, previewSettings: Record<string, unknown>): Promise<void> {
  const userId = await requireUserId();
  const row = await getOwnedRow(id, userId);
  if (isResultRow(row)) return;
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(row.storage_path);
  if (error || !blob) throw new Error(error?.message ?? "No se pudo copiar el GLB original.");
  await saveResultCopy(row, id, userId, blob, previewSettings);
}

export async function setReferenceAssetProcessing(id: string, _previewSettings: Record<string, unknown>): Promise<void> {
  const userId = await requireUserId();
  await keepSourceClean(id, userId);
}

export async function saveRiggedReferenceAsset(
  id: string,
  resultUrl: string,
  previewSettings: Record<string, unknown>,
): Promise<ReferenceAsset> {
  const userId = await requireUserId();
  const row = await getOwnedRow(id, userId);
  if (isResultRow(row)) throw new Error("Elegí el GLB original para crear un intento nuevo desde cero.");

  const response = await fetch(resultUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`El resultado del worker no se pudo descargar (HTTP ${response.status}).`);
  const bytes = await response.arrayBuffer();
  const magic = new TextDecoder().decode(bytes.slice(0, 4));
  if (magic !== "glTF") throw new Error("El worker devolvió un archivo que no es un GLB válido.");

  return saveResultCopy(
    row,
    id,
    userId,
    new Blob([bytes], { type: "model/gltf-binary" }),
    previewSettings,
  );
}

export async function markReferenceAssetError(id: string): Promise<void> {
  const userId = await requireUserId();
  await keepSourceClean(id, userId);
}

export async function deleteReferenceAsset(id: string): Promise<void> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from(TABLE)
    .select("storage_path,rigged_storage_path")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo localizar el GLB: ${error.message}`);
  if (!data) return;

  const paths = [data.storage_path, data.rigged_storage_path]
    .filter((value): value is string => Boolean(value));
  const { error: storageError } = await supabase.storage.from(BUCKET).remove([...new Set(paths)]);
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
    previewSettings: {},
    status: "reference",
    isTemplate: false,
    isSource: true,
    file,
  };
}
