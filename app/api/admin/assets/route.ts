import { NextRequest, NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";
import { MediaApiError, requireMediaAdmin } from "@/lib/server/media-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// clouva-generated-media is the canonical media bucket already used by the
// production Cloud Run runtime. Keep admin assets isolated under this prefix.
const BUCKET_NAME = process.env.CLOUVA_ADMIN_ASSETS_BUCKET ?? process.env.CLOUVA_GENERATED_MEDIA_BUCKET ?? "clouva-generated-media";
const ROOT_PREFIX = "admin-assets";
const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "model/gltf-binary",
  "model/gltf+json",
  "application/octet-stream",
  "application/pdf",
]);

const FLOWS_ASSET_RENAMES = [
  ["file_000000003c70820ea2b371171c25df8e.png", "01_flows_sudamerica.png"],
  ["file_000000003b04820e860ed6a47ebcfaef.png", "02_flows_norteamerica.png"],
  ["file_0000000073f8820eb69e8634886203d1.png", "03_flows_europa.png"],
  ["file_000000005cd4820e9a811515e66cf30a.png", "04_flows_africa.png"],
  ["file_000000000984820eafb72572e630b7c8.png", "05_flows_asia.png"],
  ["file_000000009098820eac4d055c6bc1ba08.png", "06_flows_oceania.png"],
] as const;

// Assets generated for the premium Mobile Home. Keep the generated IDs only as
// migration aliases; the canonical names describe their real role in CLOUVA.
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
    .slice(0, 120) || "asset";
}

function normalizeFolder(value: string) {
  const folder = value.split("/").map(safeSegment).filter(Boolean).join("/");
  return folder || "uploads";
}

function objectPrefix(folder: string) {
  return `${ROOT_PREFIX}/${folder}`;
}

function publicUrl(objectPath: string) {
  return `https://storage.googleapis.com/${BUCKET_NAME}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
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
      if (canonicalExists) {
        console.warn(`[admin-assets] canonical asset already exists: ${canonicalPath}`);
        continue;
      }

      await currentFile.move(canonicalPath);
      console.info(`[admin-assets] renamed ${currentPath} -> ${canonicalPath}`);
    } catch (error) {
      // A rename must never prevent the admin library from loading. The next
      // refresh retries any asset that still has its generated file_* name.
      console.error(`[admin-assets] could not rename ${currentPath}`, error);
    }
  }
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
    await requireMediaAdmin(request);
    const folder = normalizeFolder(request.nextUrl.searchParams.get("folder") ?? "uploads");
    await renameCanonicalBrandAssets(folder);
    const prefix = objectPrefix(folder);
    const [files] = await getStorage().bucket(BUCKET_NAME).getFiles({ prefix: `${prefix}/`, autoPaginate: false, maxResults: 100 });
    const items = files
      .filter((file) => file.name && !file.name.endsWith("/"))
      .map((file) => ({
        name: file.name.split("/").at(-1) ?? file.name,
        path: file.name,
        url: publicUrl(file.name),
        size: Number(file.metadata.size ?? 0),
        contentType: file.metadata.contentType ?? null,
        updatedAt: file.metadata.updated ?? null,
      }))
      .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
    return NextResponse.json({ bucket: BUCKET_NAME, folder, items });
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

    return NextResponse.json({ ok: true, asset: { name: finalName, path: objectPath, url: publicUrl(objectPath), size: bytes.length, contentType: mimeType } });
  } catch (error) {
    const mapped = assetStorageError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
