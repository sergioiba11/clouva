import { NextRequest, NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MediaApiError, requireMediaAdmin } from "@/lib/server/media-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type AssetSource = "gcs" | "supabase";

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

const BUCKET_NAME = process.env.CLOUVA_ADMIN_ASSETS_BUCKET ?? process.env.CLOUVA_GENERATED_MEDIA_BUCKET ?? "clouva-generated-media";
const ROOT_PREFIX = "admin-assets";
const MAX_BYTES = 50 * 1024 * 1024;
const LIST_PAGE_SIZE = 1000;
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/gif",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "model/gltf-binary",
  "model/gltf+json",
  "application/octet-stream",
  "application/pdf",
  "application/json",
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

function normalizeSource(value: string | null): AssetSource | "all" {
  return value === "gcs" || value === "supabase" ? value : "all";
}

function matchesQuery(asset: UnifiedAsset, query: string) {
  if (!query) return true;
  const haystack = `${asset.name} ${asset.path} ${asset.bucket} ${asset.contentType ?? ""} ${asset.source}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
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
      folder: folderOf(file.name),
      url: publicGcsUrl(BUCKET_NAME, file.name),
      size: Number(file.metadata.size ?? 0),
      contentType: file.metadata.contentType ?? null,
      updatedAt: file.metadata.updated ?? null,
    }))
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

function parseMutationBody(value: unknown) {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const source = body.source === "gcs" || body.source === "supabase" ? body.source : null;
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
  return { status: 500, body: { error: "No se pudo acceder al almacenamiento de assets.", code: "asset_storage_failed" } };
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireMediaAdmin(request);
    const source = normalizeSource(request.nextUrl.searchParams.get("source"));
    const requestedBucket = request.nextUrl.searchParams.get("bucket")?.trim() ?? "";
    const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";

    const items: UnifiedAsset[] = [];
    const buckets: StorageBucket[] = [];

    if (source === "all" || source === "gcs") {
      items.push(...await listGcsAssets(query));
      buckets.push({ source: "gcs", name: BUCKET_NAME, public: true });
    }

    if (source === "all" || source === "supabase") {
      const supabase = await listSupabaseAssets(admin, source === "supabase" ? requestedBucket : "", query);
      items.push(...supabase.items);
      buckets.push(...supabase.buckets);
    }

    items.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")) || a.path.localeCompare(b.path));

    return NextResponse.json({
      items,
      buckets,
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
    if (!ALLOWED_MIME.has(mimeType)) throw new MediaApiError("Formato no permitido.", 415, "invalid_file_type");

    const folder = normalizeFolder(String(form.get("folder") ?? "uploads"));
    await renameCanonicalBrandAssets(folder);
    const requestedName = String(form.get("name") ?? "").trim();
    const originalName = safeSegment(file.name);
    const finalName = requestedName ? safeSegment(requestedName) : originalName;
    const objectPath = `${objectPrefix(folder)}/${finalName}`;
    const bytes = Buffer.from(await file.arrayBuffer());

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
        folder: folderOf(objectPath),
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
    } else {
      await assertSupabaseBucket(admin, bucket);
      const folderPath = folderOf(nextPath);
      const { data: siblings, error: siblingError } = await admin.storage.from(bucket).list(folderPath, { search: finalName, limit: 100 });
      if (siblingError) throw new MediaApiError(`No se pudo validar el nombre: ${siblingError.message}`, 502, "supabase_storage_list_failed");
      if ((siblings ?? []).some((item) => item.name === finalName && item.id)) {
        throw new MediaApiError("Ya existe un asset con ese nombre en esta carpeta.", 409, "asset_name_conflict");
      }
      const { error } = await admin.storage.from(bucket).move(path, nextPath);
      if (error) throw new MediaApiError(`No se pudo renombrar: ${error.message}`, 502, "asset_rename_failed");
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
    } else {
      await assertSupabaseBucket(admin, bucket);
      const { error } = await admin.storage.from(bucket).remove([path]);
      if (error) throw new MediaApiError(`No se pudo eliminar: ${error.message}`, 502, "asset_delete_failed");
    }

    return NextResponse.json({ ok: true, path });
  } catch (error) {
    const mapped = assetStorageError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
