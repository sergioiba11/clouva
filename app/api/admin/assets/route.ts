import { NextRequest, NextResponse } from "next/server";
import { Storage } from "@google-cloud/storage";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET_NAME = process.env.CLOUVA_CREATOR_ASSETS_BUCKET ?? "clouva-creator-assets";
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
  const folder = value
    .split("/")
    .map(safeSegment)
    .filter(Boolean)
    .join("/");
  return folder || "uploads";
}

function publicUrl(objectPath: string) {
  return `https://storage.googleapis.com/${BUCKET_NAME}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
}

export async function GET(request: NextRequest) {
  try {
    await requireMediaAdmin(request);
    const prefix = normalizeFolder(request.nextUrl.searchParams.get("folder") ?? "uploads");
    const [files] = await getStorage().bucket(BUCKET_NAME).getFiles({
      prefix: `${prefix}/`,
      autoPaginate: false,
      maxResults: 100,
    });
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
    return NextResponse.json({ bucket: BUCKET_NAME, folder: prefix, items });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireMediaAdmin(request);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new MediaApiError("Elegí un archivo.", 400, "file_required");
    if (file.size <= 0 || file.size > MAX_BYTES) {
      throw new MediaApiError("El archivo debe pesar hasta 50 MB.", 413, "file_too_large");
    }
    const mimeType = file.type || "application/octet-stream";
    if (!ALLOWED_MIME.has(mimeType)) {
      throw new MediaApiError("Formato no permitido.", 415, "invalid_file_type");
    }

    const folder = normalizeFolder(String(form.get("folder") ?? "uploads"));
    const requestedName = String(form.get("name") ?? "").trim();
    const originalName = safeSegment(file.name);
    const finalName = requestedName ? safeSegment(requestedName) : originalName;
    const objectPath = `${folder}/${finalName}`;
    const bytes = Buffer.from(await file.arrayBuffer());

    await getStorage().bucket(BUCKET_NAME).file(objectPath).save(bytes, {
      resumable: false,
      contentType: mimeType,
      metadata: { cacheControl: "public, max-age=300" },
    });

    return NextResponse.json({
      ok: true,
      asset: { name: finalName, path: objectPath, url: publicUrl(objectPath), size: bytes.length, contentType: mimeType },
    });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
