import { NextRequest, NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MediaApiError, requireMediaAdmin } from "@/lib/server/media-auth";
import { extractAssetPack } from "@/lib/admin-assets/zip-pack";
import {
  deletePublicRepositoryAsset,
  listPublicRepositoryAssets,
  renamePublicRepositoryAsset,
} from "@/lib/clouva-ai/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type AssetSource = "gcs" | "supabase" | "github";

type UnifiedAsset = {
  source: AssetSource;
  bucket: string;
  name: string;
  path: string;
  folder: string;
  url: string | null;
  size: number;
  contentType: string | null;
  updatedAt: string | null;
};

type StorageBucket = {
  source: AssetSource;
  name: string;
  public: boolean | null;
};

type SourceWarning = {
  source: AssetSource;
  message: string;
};

type CreatorReferenceRow = Record<string, unknown> & {
  id: string;
  storage_path: string | null;
  rigged_storage_path: string | null;
  file_name: string | null;
};

const BUCKET_NAME = process.env.CLOUVA_ADMIN_ASSETS_BUCKET ?? process.env.CLOUVA_GENERATED_MEDIA_BUCKET ?? "clouva-generated-media";
const ROOT_PREFIX = "admin-assets";
const MAX_BYTES = 50 * 1024 * 1024;
const LIST_PAGE_SIZE = 1000;
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const CREATOR_REFERENCE_BUCKET = "creator-reference-assets";
const CREATOR_REFERENCE_TABLE = "creator_reference_assets";
const ZIP_MIME = new Set(["application/zip", "application/x-zip-compressed", "application/x-zip"]);
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/gif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/icns",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/mp4",
  "model/gltf-binary",
  "model/gltf+json",
  "application/octet-stream",
  "application/pdf",
  "application/json",
  "application/manifest+json",
  "application/xml",
  "text/xml",
  "text/plain",
  "text/css",
  "font/ttf",
  "font/otf",
  "font/woff",
  "font/woff2",
]);

const FLOWS_ASSET_RENAMES = [
  ["file_000000003c70820ea2b371171c25df8e.png", "01_flows_sudamerica.png"],
  ["file_000000003b04820e860ed6a47ebcfaef.png", "02_flows_norteamerica.png"],
  ["file_0000000073f8820eb69e8634886203d1.png", "03_flows_europa.png"],
  ["file_000000005cd4820e9a811515e66cf30a.png", "04_flows_africa.png"],
  ["file_000000000984820eafb72572e630b7c8.png", "05_flows_asia.png"],
  ["file_000000009098820eac4d055c6bc1ba08.png", "06_flows_oceania.png"],
] as const;

const HOME_ASSET_RENAMES = [
  ["file_000000004938820e8f838ddf57895198.png", "01_home_mobile_hero.png"],
  ["file_000000004348820ebe4774ceb8daa79a.png", "02_home_mobile_orbits.png"],
  ["file_000000005524820eb958f10903989146.png", "01_home_mobile_hero_alt_01.png"],
  ["file_00000000a81c820ebd05ed72c7f70012.png", "01_home_mobile_hero_alt_02.png"],
  ["file_0000000064d8820eb014cdc3ef3f66a8.png", "01_home_mobile_hero_alt_03.png"],
] as const;

const BRAND_ASSET_RENAMES = [...FLOWS_ASSET_RENAMES, ...HOME_ASSET_RENAMES] as const;

let storage: Storage | null = null;
function getStorage() {
  if (!storage) storage = new Storage();
  return storage;
}

function safeSegment(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || "asset";
}

function normalizeFolder(value: string) {
  const folder = value.split("/").map(safeSegment).filter(Boolean).join("/");
  return folder || "uploads";
}

function objectPrefix(folder: string) {
  return `${ROOT_PREFIX}/${folder}`;
}

function publicGcsUrl(bucket: string, objectPath: string) {
  return `https://storage.googleapis.com/${bucket}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
}

function folderOf(path: string) {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) : "";
}

function relativeAdminFolder(path: string) {
  const folder = folderOf(path);
  if (folder === ROOT_PREFIX) return "";
  if (folder.startsWith(`${ROOT_PREFIX}/`)) return folder.slice(ROOT_PREFIX.length + 1);
  return folder;
}

function normalizeSource(value: string | null): AssetSource | "all" {
  return value === "gcs" || value === "supabase" || value === "github" ? value : "all";
}

function contentTypeFromName(name: string) {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  const byExtension: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    icns: "image/icns",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    glb: "model/gltf-binary",
    gltf: "model/gltf+json",
    pdf: "application/pdf",
    json: "application/json",
    webmanifest: "application/manifest+json",
    xml: "application/xml",
    txt: "text/plain",
    css: "text/css",
    ttf: "font/ttf",
    otf: "font/otf",
    woff: "font/woff",
    woff2: "font/woff2",
  };
  return byExtension[extension] ?? null;
}

function matchesQuery(asset: UnifiedAsset, query: string) {
  if (!query) return true;
  const haystack = `${asset.name} ${asset.path} ${asset.bucket} ${asset.contentType ?? ""} ${asset.source}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo leer esta fuente de assets.";
}

async function renameCanonicalBrandAssets(folder: string) {
  if (folder !== "brand") return;

  const bucket = getStorage().bucket(BUCKET_NAME);
  for (const [currentName, canonicalName] of BRAND_ASSET_RENAMES) {
    const currentPath = `${objectPrefix(folder)}/${currentName}`;
    const canonicalPath = `${objectPrefix(folder)}/${canonicalName}`;
    const currentFile = bucket.file(currentPath);
    const canonicalFile = bucket.file(canonicalPath);

    try {
      const [currentExists] = await currentFile.exists();
      if (!currentExists) continue;

      const [canonicalExists] = await canonicalFile.exists();
      if (canonicalExists) continue;
      await currentFile.move(canonicalPath);
    } catch (error) {
      console.error(`[admin-assets] could not rename ${currentPath}`, error);
    }
  }
}

async function listGcsAssets(query: string): Promise<UnifiedAsset[]> {
  const [files] = await getStorage().bucket(BUCKET_NAME).getFiles({ autoPaginate: true });
  return files
    .filter((file) => file.name && !file.name.endsWith("/"))
    .map((file) => ({
      source: "gcs" as const,
      bucket: BUCKET_NAME,
      name: file.name.split("/").at(-1) ?? file.name,
      path: file.name,
      folder: relativeAdminFolder(file.name),
      url: publicGcsUrl(BUCKET_NAME, file.name),
      size: Number(file.metadata.size ?? 0),
      contentType: file.metadata.contentType ?? null,
      updatedAt: file.metadata.updated ?? null,
    }))
    .filter((asset) => matchesQuery(asset, query));
}

async function listGitHubAssets(query: string): Promise<UnifiedAsset[]> {
  const { files } = await listPublicRepositoryAssets();
  return files
    .map((file) => {
      const name = file.path.split("/").at(-1) ?? file.path;
      return {
        source: "github" as const,
        bucket: "public",
        name,
        path: file.path,
        folder: folderOf(file.path),
        url: file.path.startsWith("public/") ? `/${file.path.slice("public/".length)}` : null,
        size: file.size,
        contentType: contentTypeFromName(name),
        updatedAt: null,
      };
    })
    .filter((asset) => matchesQuery(asset, query));
}

function isSupabaseFolder(item: { id?: string | null; metadata?: unknown }) {
  return !item.id && !item.metadata;
}

async function listSupabaseObjects(admin: SupabaseClient, bucketName: string): Promise<UnifiedAsset[]> {
  const bucket = admin.storage.from(bucketName);
  const stack = [""];
  const assets: UnifiedAsset[] = [];

  while (stack.length) {
    const folder = stack.pop() ?? "";
    let offset = 0;

    for (;;) {
      const { data, error } = await bucket.list(folder, {
        limit: LIST_PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new MediaApiError(`No se pudo leer ${bucketName}: ${error.message}`, 502, "supabase_storage_list_failed");

      const entries = data ?? [];
      for (const item of entries) {
        const path = folder ? `${folder}/${item.name}` : item.name;
        if (isSupabaseFolder(item)) {
          stack.push(path);
          continue;
        }

        const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata as Record<string, unknown> : {};
        assets.push({
          source: "supabase",
          bucket: bucketName,
          name: item.name,
          path,
          folder,
          url: null,
          size: Number(metadata.size ?? 0),
          contentType: typeof metadata.mimetype === "string" ? metadata.mimetype : null,
          updatedAt: item.updated_at ?? item.created_at ?? null,
        });
      }

      if (entries.length < LIST_PAGE_SIZE) break;
      offset += entries.length;
    }
  }

  return assets;
}

async function attachSupabaseUrls(admin: SupabaseClient, bucketInfo: { id: string; public: boolean }, assets: UnifiedAsset[]) {
  if (!assets.length) return assets;
  const bucket = admin.storage.from(bucketInfo.id);

  if (bucketInfo.public) {
    return assets.map((asset) => ({ ...asset, url: bucket.getPublicUrl(asset.path).data.publicUrl }));
  }

  const byPath = new Map<string, string>();
  for (let index = 0; index < assets.length; index += 100) {
    const paths = assets.slice(index, index + 100).map((asset) => asset.path);
    const { data, error } = await bucket.createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    if (error) {
      console.error(`[admin-assets] could not sign ${bucketInfo.id}`, error);
      continue;
    }
    for (const signed of data ?? []) {
      if (signed.path && signed.signedUrl) byPath.set(signed.path, signed.signedUrl);
    }
  }

  return assets.map((asset) => ({ ...asset, url: byPath.get(asset.path) ?? null }));
}

async function listSupabaseAssets(admin: SupabaseClient, requestedBucket: string, query: string) {
  const { data: buckets, error } = await admin.storage.listBuckets();
  if (error) throw new MediaApiError(`No se pudieron listar los buckets de Supabase: ${error.message}`, 502, "supabase_bucket_list_failed");

  const selected = (buckets ?? []).filter((bucket) => !requestedBucket || bucket.id === requestedBucket || bucket.name === requestedBucket);
  const all: UnifiedAsset[] = [];

  for (const bucketInfo of selected) {
    const objects = await listSupabaseObjects(admin, bucketInfo.id);
    const filtered = objects.filter((asset) => matchesQuery(asset, query));
    all.push(...await attachSupabaseUrls(admin, { id: bucketInfo.id, public: Boolean(bucketInfo.public) }, filtered));
  }

  const bucketList: StorageBucket[] = (buckets ?? []).map((bucket) => ({
    source: "supabase",
    name: bucket.id,
    public: Boolean(bucket.public),
  }));

  return { items: all, buckets: bucketList };
}

async function assertSupabaseBucket(admin: SupabaseClient, bucketName: string) {
  if (!bucketName) throw new MediaApiError("Falta el bucket del asset.", 400, "bucket_required");
  const { data, error } = await admin.storage.getBucket(bucketName);
  if (error || !data) throw new MediaApiError("El bucket de Supabase no existe.", 404, "bucket_not_found");
  return data;
}

async function getCreatorReferenceRows(admin: SupabaseClient, path: string): Promise<CreatorReferenceRow[]> {
  const [stored, rigged] = await Promise.all([
    admin.from(CREATOR_REFERENCE_TABLE).select("*").eq("storage_path", path),
    admin.from(CREATOR_REFERENCE_TABLE).select("*").eq("rigged_storage_path", path),
  ]);
  if (stored.error || rigged.error) {
    throw new MediaApiError(
      `No se pudieron comprobar las referencias de Creator Studio: ${stored.error?.message ?? rigged.error?.message ?? "error desconocido"}`,
      502,
      "creator_reference_lookup_failed",
    );
  }

  const rows = new Map<string, CreatorReferenceRow>();
  for (const row of [...(stored.data ?? []), ...(rigged.data ?? [])]) {
    if (row?.id) rows.set(String(row.id), row as CreatorReferenceRow);
  }
  return [...rows.values()];
}

async function restoreCreatorReferenceRows(admin: SupabaseClient, rows: CreatorReferenceRow[]) {
  if (!rows.length) return;
  const { error } = await admin.from(CREATOR_REFERENCE_TABLE).upsert(rows);
  if (error) console.error("[admin-assets] could not rollback creator reference rows", error);
}

async function syncCreatorReferenceRename(
  admin: SupabaseClient,
  rows: CreatorReferenceRow[],
  currentPath: string,
  nextPath: string,
  finalName: string,
) {
  if (!rows.length) return;

  try {
    for (const row of rows) {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (row.storage_path === currentPath) {
        updates.storage_path = nextPath;
        updates.file_name = finalName;
      }
      if (row.rigged_storage_path === currentPath) updates.rigged_storage_path = nextPath;
      const { error } = await admin.from(CREATOR_REFERENCE_TABLE).update(updates).eq("id", row.id);
      if (error) throw error;
    }
  } catch (error) {
    await restoreCreatorReferenceRows(admin, rows);
    throw new MediaApiError(
      `El archivo se movió, pero no se pudieron sincronizar sus referencias de Creator Studio: ${messageOf(error)}`,
      502,
      "creator_reference_rename_failed",
    );
  }
}

async function syncCreatorReferenceDelete(admin: SupabaseClient, rows: CreatorReferenceRow[], path: string) {
  if (!rows.length) return;

  try {
    for (const row of rows) {
      if (row.storage_path === path) {
        const { error } = await admin.from(CREATOR_REFERENCE_TABLE).delete().eq("id", row.id);
        if (error) throw error;
        continue;
      }

      if (row.rigged_storage_path === path) {
        const { error } = await admin.from(CREATOR_REFERENCE_TABLE).update({
          rigged_storage_path: null,
          status: "reference",
          preview_settings: {},
          updated_at: new Date().toISOString(),
        }).eq("id", row.id);
        if (error) throw error;
      }
    }
  } catch (error) {
    await restoreCreatorReferenceRows(admin, rows);
    throw new MediaApiError(
      `No se pudieron sincronizar las referencias de Creator Studio: ${messageOf(error)}`,
      502,
      "creator_reference_delete_failed",
    );
  }
}

function parseMutationBody(value: unknown) {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const source = body.source === "gcs" || body.source === "supabase" || body.source === "github" ? body.source : null;
  const bucket = typeof body.bucket === "string" ? body.bucket : "";
  const path = typeof body.path === "string" ? body.path : "";
  if (!source || !path) throw new MediaApiError("Asset inválido.", 400, "invalid_asset");
  return { source, bucket, path } as { source: AssetSource; bucket: string; path: string };
}

function assetStorageError(error: unknown) {
  if (error instanceof MediaApiError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }
  const message = error instanceof Error ? error.message : "No se pudo acceder al almacenamiento de CLOUVA.";
  const status = typeof (error as { code?: unknown })?.code === "number" ? Number((error as { code: number }).code) : 500;
  if (status === 403 || /permission|forbidden|storage\.objects/i.test(message)) {
    return { status: 503, body: { error: "CLOUVA no tiene permiso para acceder al almacenamiento de assets.", code: "storage_permission_denied" } };
  }
  if (status === 404 || /bucket.*not found/i.test(message)) {
    return { status: 503, body: { error: "No se encontró el bucket configurado para assets.", code: "storage_bucket_not_found" } };
  }
  console.error("[admin-assets] storage error", error);
  return { status: 500, body: { error: message.slice(0, 400), code: "asset_storage_failed" } };
}

async function importZipPack(file: File, bytes: Buffer) {
  let entries;
  try {
    entries = extractAssetPack(bytes);
  } catch (error) {
    throw new MediaApiError(messageOf(error), 400, "invalid_asset_pack");
  }

  const bucket = getStorage().bucket(BUCKET_NAME);
  const imported: UnifiedAsset[] = [];
  const variantCounts: Record<string, number> = {};
  const platformCounts: Record<string, number> = {};
  const sourcePack = safeSegment(file.name);
  const concurrency = 10;

  for (let start = 0; start < entries.length; start += concurrency) {
    const batch = entries.slice(start, start + concurrency);
    const results = await Promise.all(batch.map(async (entry) => {
      const objectPath = `${objectPrefix(entry.destinationFolder)}/${entry.fileName}`;
      await bucket.file(objectPath).save(entry.bytes, {
        resumable: false,
        contentType: entry.contentType,
        metadata: {
          cacheControl: "public, max-age=300",
          metadata: {
            sourcePack,
            assetVariant: entry.variant,
            assetPlatform: entry.platform,
            originalArchivePath: entry.originalPath.slice(0, 1024),
          },
        },
      });
      const asset: UnifiedAsset = {
        source: "gcs",
        bucket: BUCKET_NAME,
        name: entry.fileName,
        path: objectPath,
        folder: entry.destinationFolder,
        url: publicGcsUrl(BUCKET_NAME, objectPath),
        size: entry.bytes.length,
        contentType: entry.contentType,
        updatedAt: new Date().toISOString(),
      };
      return { asset, variant: entry.variant, platform: entry.platform };
    }));

    for (const result of results) {
      imported.push(result.asset);
      variantCounts[result.variant] = (variantCounts[result.variant] ?? 0) + 1;
      platformCounts[result.platform] = (platformCounts[result.platform] ?? 0) + 1;
    }
  }

  return {
    imported,
    variantCounts,
    platformCounts,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireMediaAdmin(request);
    const source = normalizeSource(request.nextUrl.searchParams.get("source"));
    const requestedBucket = request.nextUrl.searchParams.get("bucket")?.trim() ?? "";
    const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

    const items: UnifiedAsset[] = [];
    const buckets: StorageBucket[] = [];
    const warnings: SourceWarning[] = [];

    if (source === "all" || source === "gcs") {
      try {
        items.push(...await listGcsAssets(query));
        buckets.push({ source: "gcs", name: BUCKET_NAME, public: true });
      } catch (error) {
        if (source === "gcs") throw error;
        warnings.push({ source: "gcs", message: messageOf(error) });
      }
    }

    if (source === "all" || source === "supabase") {
      try {
        const supabase = await listSupabaseAssets(admin, source === "supabase" ? requestedBucket : "", query);
        items.push(...supabase.items);
        buckets.push(...supabase.buckets);
      } catch (error) {
        if (source === "supabase") throw error;
        warnings.push({ source: "supabase", message: messageOf(error) });
      }
    }

    if (source === "all" || source === "github") {
      try {
        items.push(...await listGitHubAssets(query));
        buckets.push({ source: "github", name: "public", public: true });
      } catch (error) {
        if (source === "github") throw error;
        warnings.push({ source: "github", message: messageOf(error) });
      }
    }

    items.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")) || a.path.localeCompare(b.path));

    return NextResponse.json({
      items,
      buckets,
      warnings,
      total: items.length,
      gcsBucket: BUCKET_NAME,
    });
  } catch (error) {
    const mapped = assetStorageError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireMediaAdmin(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new MediaApiError("Elegí un archivo.", 400, "file_required");
    if (file.size <= 0 || file.size > MAX_BYTES) throw new MediaApiError("El archivo debe pesar hasta 50 MB.", 413, "file_too_large");

    const mimeType = file.type || "application/octet-stream";
    const isZip = file.name.toLowerCase().endsWith(".zip") || ZIP_MIME.has(mimeType);
    const bytes = Buffer.from(await file.arrayBuffer());

    if (isZip) {
      const result = await importZipPack(file, bytes);
      return NextResponse.json({
        ok: true,
        kind: "asset-pack",
        imported: result.imported.length,
        variants: result.variantCounts,
        platforms: result.platformCounts,
        asset: result.imported[0] ?? null,
      });
    }

    if (!ALLOWED_MIME.has(mimeType)) throw new MediaApiError("Formato no permitido.", 415, "invalid_file_type");

    const folder = normalizeFolder(String(form.get("folder") ?? "uploads"));
    await renameCanonicalBrandAssets(folder);
    const requestedName = String(form.get("name") ?? "").trim();
    const originalName = safeSegment(file.name);
    const finalName = requestedName ? safeSegment(requestedName) : originalName;
    const objectPath = `${objectPrefix(folder)}/${finalName}`;

    await getStorage().bucket(BUCKET_NAME).file(objectPath).save(bytes, {
      resumable: false,
      contentType: mimeType,
      metadata: { cacheControl: "public, max-age=300" },
    });

    return NextResponse.json({
      ok: true,
      asset: {
        source: "gcs",
        bucket: BUCKET_NAME,
        name: finalName,
        path: objectPath,
        folder,
        url: publicGcsUrl(BUCKET_NAME, objectPath),
        size: bytes.length,
        contentType: mimeType,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const mapped = assetStorageError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { admin } = await requireMediaAdmin(request);
    const raw = await request.json();
    const { source, bucket, path } = parseMutationBody(raw);
    const requestedName = typeof raw?.name === "string" ? raw.name.trim() : "";
    if (!requestedName) throw new MediaApiError("Escribí el nuevo nombre.", 400, "name_required");

    const finalName = safeSegment(requestedName);
    const folder = folderOf(path);
    const nextPath = folder ? `${folder}/${finalName}` : finalName;
    if (nextPath === path) return NextResponse.json({ ok: true, path, name: finalName });

    if (source === "gcs") {
      if (bucket && bucket !== BUCKET_NAME) throw new MediaApiError("Bucket de Cloud Storage inválido.", 400, "invalid_bucket");
      const gcsBucket = getStorage().bucket(BUCKET_NAME);
      const [sourceExists] = await gcsBucket.file(path).exists();
      if (!sourceExists) throw new MediaApiError("El asset ya no existe.", 404, "asset_not_found");
      const [targetExists] = await gcsBucket.file(nextPath).exists();
      if (targetExists) throw new MediaApiError("Ya existe un asset con ese nombre en esta carpeta.", 409, "asset_name_conflict");
      await gcsBucket.file(path).move(nextPath);
    } else if (source === "supabase") {
      await assertSupabaseBucket(admin, bucket);
      const folderPath = folderOf(nextPath);
      const storageBucket = admin.storage.from(bucket);
      const { data: siblings, error: siblingError } = await storageBucket.list(folderPath, { search: finalName, limit: 100 });
      if (siblingError) throw new MediaApiError(`No se pudo validar el nombre: ${siblingError.message}`, 502, "supabase_storage_list_failed");
      if ((siblings ?? []).some((item) => item.name === finalName && item.id)) {
        throw new MediaApiError("Ya existe un asset con ese nombre en esta carpeta.", 409, "asset_name_conflict");
      }

      const referenceRows = bucket === CREATOR_REFERENCE_BUCKET ? await getCreatorReferenceRows(admin, path) : [];
      const { error } = await storageBucket.move(path, nextPath);
      if (error) throw new MediaApiError(`No se pudo renombrar: ${error.message}`, 502, "asset_rename_failed");

      try {
        await syncCreatorReferenceRename(admin, referenceRows, path, nextPath, finalName);
      } catch (error) {
        const rollback = await storageBucket.move(nextPath, path);
        if (rollback.error) console.error("[admin-assets] could not rollback storage rename", rollback.error);
        throw error;
      }
    } else {
      try {
        const renamed = await renamePublicRepositoryAsset(path, finalName);
        return NextResponse.json({ ok: true, path: renamed.path, name: renamed.name, updatedReferences: renamed.updatedReferences, commitSha: renamed.commitSha });
      } catch (error) {
        const message = messageOf(error);
        const status = /ya existe/i.test(message) ? 409 : /no encontró|no existe/i.test(message) ? 404 : 502;
        throw new MediaApiError(message, status, "github_asset_rename_failed");
      }
    }

    return NextResponse.json({ ok: true, path: nextPath, name: finalName });
  } catch (error) {
    const mapped = assetStorageError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { admin } = await requireMediaAdmin(request);
    const { source, bucket, path } = parseMutationBody(await request.json());

    if (source === "gcs") {
      if (bucket && bucket !== BUCKET_NAME) throw new MediaApiError("Bucket de Cloud Storage inválido.", 400, "invalid_bucket");
      await getStorage().bucket(BUCKET_NAME).file(path).delete();
    } else if (source === "supabase") {
      await assertSupabaseBucket(admin, bucket);
      const storageBucket = admin.storage.from(bucket);
      const referenceRows = bucket === CREATOR_REFERENCE_BUCKET ? await getCreatorReferenceRows(admin, path) : [];
      let backup: Blob | null = null;

      if (referenceRows.length) {
        const downloaded = await storageBucket.download(path);
        if (downloaded.error || !downloaded.data) {
          throw new MediaApiError(`No se pudo preparar una copia de seguridad antes de eliminar: ${downloaded.error?.message ?? "archivo no disponible"}`, 502, "asset_backup_failed");
        }
        backup = downloaded.data;
      }

      const { error } = await storageBucket.remove([path]);
      if (error) throw new MediaApiError(`No se pudo eliminar: ${error.message}`, 502, "asset_delete_failed");

      try {
        await syncCreatorReferenceDelete(admin, referenceRows, path);
      } catch (error) {
        if (backup) {
          const restored = await storageBucket.upload(path, backup, {
            upsert: true,
            ...(backup.type ? { contentType: backup.type } : {}),
          });
          if (restored.error) console.error("[admin-assets] could not restore deleted storage object", restored.error);
        }
        throw error;
      }
    } else {
      try {
        const result = await deletePublicRepositoryAsset(path);
        if (!result.deleted) {
          const detail = result.references.slice(0, 4).join(", ");
          throw new MediaApiError(
            `Este asset está usado por ${result.totalReferences} archivo${result.totalReferences === 1 ? "" : "s"} del repo (${detail}). Renombralo para actualizar las referencias automáticamente o quitá esos usos antes de eliminarlo.`,
            409,
            "github_asset_in_use",
          );
        }
        return NextResponse.json({ ok: true, path: result.path, commitSha: result.commitSha });
      } catch (error) {
        if (error instanceof MediaApiError) throw error;
        const message = messageOf(error);
        const status = /no encontró|no existe/i.test(message) ? 404 : 502;
        throw new MediaApiError(message, status, "github_asset_delete_failed");
      }
    }

    return NextResponse.json({ ok: true, path });
  } catch (error) {
    const mapped = assetStorageError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
