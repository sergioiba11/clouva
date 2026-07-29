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

function detectImageMime(bytes: Buffer) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

async function readLimitedBody(response: Response) {
  if (!response.body) throw new Error("Instagram devolvió una respuesta vacía.");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel("image_too_large");
      throw new Error("La imagen supera el tamaño permitido.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
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
      redirect: "error",
      headers: { "user-agent": "CLOUVA-Media-Importer/1.0" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`No se pudo descargar la imagen (HTTP ${response.status}).`);

    const declaredMime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
    if (!ALLOWED_MIME.has(declaredMime)) throw new Error("Instagram devolvió un formato de imagen no admitido.");

    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_BYTES) throw new Error("La imagen supera el tamaño permitido.");

    const bytes = await readLimitedBody(response);
    const detectedMime = detectImageMime(bytes);
    if (!detectedMime || detectedMime !== declaredMime) {
      throw new Error("El contenido descargado no coincide con un formato de imagen permitido.");
    }

    const bucketName = process.env.CLOUVA_PUBLIC_MEDIA_BUCKET || process.env.CLOUVA_GENERATED_MEDIA_BUCKET || DEFAULT_BUCKET;
    const objectPath = `public-identity/${args.ownerType}/${args.ownerId}/${args.purpose}/${crypto.randomUUID()}.${extensionForMime(detectedMime)}`;
    const file = getStorage().bucket(bucketName).file(objectPath);
    await file.save(bytes, {
      contentType: detectedMime,
      resumable: false,
      metadata: { cacheControl: "public, max-age=31536000, immutable" },
    });

    return {
      storagePath: objectPath,
      publicUrl: `https://storage.googleapis.com/${bucketName}/${objectPath}`,
      mimeType: detectedMime,
      size: bytes.length,
    };
  } finally {
    clearTimeout(timeout);
  }
}
