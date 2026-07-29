import { Storage } from "@google-cloud/storage";

const DEFAULT_BUCKET = "clouva-generated-media";
const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

let storage: Storage | null = null;
function getStorage() {
  if (!storage) storage = new Storage();
  return storage;
}

function isAllowedInstagramHost(hostname: string) {
  const host = hostname.toLowerCase();
  return (
    host === "instagram.com" ||
    host.endsWith(".instagram.com") ||
    host === "cdninstagram.com" ||
    host.endsWith(".cdninstagram.com") ||
    host === "fbcdn.net" ||
    host.endsWith(".fbcdn.net")
  );
}

function extensionForMime(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

export async function importInstagramImage(args: {
  url: string;
  ownerType: "players" | "studios";
  ownerId: string;
  purpose: "profile" | "cover" | "gallery" | "thumbnail";
}) {
  const source = new URL(args.url);
  if (source.protocol !== "https:" || !isAllowedInstagramHost(source.hostname)) {
    throw new Error("La imagen de Instagram proviene de un host no permitido.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(source, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "CLOUVA-Media-Importer/1.0" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`No se pudo descargar la imagen (HTTP ${response.status}).`);

    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
    if (!ALLOWED_MIME.has(mimeType)) throw new Error("Instagram devolvió un formato de imagen no admitido.");

    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_BYTES) throw new Error("La imagen supera el tamaño permitido.");

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error("La imagen supera el tamaño permitido.");

    const bucketName = process.env.CLOUVA_PUBLIC_MEDIA_BUCKET || process.env.CLOUVA_GENERATED_MEDIA_BUCKET || DEFAULT_BUCKET;
    const objectPath = `public-identity/${args.ownerType}/${args.ownerId}/${args.purpose}/${crypto.randomUUID()}.${extensionForMime(mimeType)}`;
    const file = getStorage().bucket(bucketName).file(objectPath);
    await file.save(bytes, {
      contentType: mimeType,
      resumable: false,
      metadata: { cacheControl: "public, max-age=31536000, immutable" },
    });

    return {
      storagePath: objectPath,
      publicUrl: `https://storage.googleapis.com/${bucketName}/${objectPath}`,
      mimeType,
      size: bytes.length,
    };
  } finally {
    clearTimeout(timeout);
  }
}
