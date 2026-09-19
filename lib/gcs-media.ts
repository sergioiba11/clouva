import { Storage } from "@google-cloud/storage";

// Bucket público para assets generados/reconstruidos que se referencian desde
// Supabase. Auth por ADC del servicio de Cloud Run.
const BUCKET_NAME = process.env.CLOUVA_GENERATED_MEDIA_BUCKET ?? "clouva-generated-media";

export function generatedMediaBucketName() {
  return BUCKET_NAME;
}

export function generatedMediaGsUri(pathPrefix: string) {
  const normalized = pathPrefix.replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.includes("..")) throw new Error("Ruta de almacenamiento inválida.");
  return `gs://${BUCKET_NAME}/${normalized}`;
}

export function generatedMediaUrlToGsUri(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Ruta de almacenamiento vacía.");
  if (trimmed.startsWith("gs://")) {
    const parsed = trimmed.slice(5);
    const slash = parsed.indexOf("/");
    const bucket = slash >= 0 ? parsed.slice(0, slash) : parsed;
    const objectPath = slash >= 0 ? parsed.slice(slash + 1) : "";
    if (bucket !== BUCKET_NAME || !objectPath || objectPath.includes("..")) {
      throw new Error("La referencia no pertenece al almacenamiento seguro de CLOUVA.");
    }
    return `gs://${bucket}/${objectPath}`;
  }
  if (/^https:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed);
    const prefix = `/${BUCKET_NAME}/`;
    if (parsed.protocol !== "https:" || parsed.hostname !== "storage.googleapis.com" || !parsed.pathname.startsWith(prefix)) {
      throw new Error("La referencia no pertenece al almacenamiento seguro de CLOUVA.");
    }
    const objectPath = decodeURIComponent(parsed.pathname.slice(prefix.length));
    if (!objectPath || objectPath.includes("..")) throw new Error("Ruta de almacenamiento inválida.");
    return `gs://${BUCKET_NAME}/${objectPath}`;
  }
  const objectPath = trimmed.replace(/^\/+/, "");
  if (!objectPath || objectPath.includes("..")) throw new Error("Ruta de almacenamiento inválida.");
  return `gs://${BUCKET_NAME}/${objectPath}`;
}

export function generatedMediaObjectFromGsUri(uri: string) {
  const prefix = `gs://${BUCKET_NAME}/`;
  if (!uri.startsWith(prefix)) throw new Error("El resultado no pertenece al bucket de CLOUVA.");
  const objectPath = uri.slice(prefix.length);
  if (!objectPath || objectPath.includes("..")) throw new Error("Ruta de resultado inválida.");
  return {
    objectPath,
    url: `https://storage.googleapis.com/${BUCKET_NAME}/${objectPath}`,
  };
}

let storage: Storage | null = null;
function getStorage() {
  if (!storage) storage = new Storage();
  return storage;
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
  "application/json": "json",
};

export async function uploadGeneratedMedia(args: {
  bytes: Buffer;
  mimeType: string;
  pathPrefix: string;
}) {
  const uploaded = await uploadGeneratedMediaObject(args);
  return uploaded.url;
}

export async function uploadGeneratedMediaObject(args: {
  bytes: Buffer;
  mimeType: string;
  pathPrefix: string;
}) {
  const extension = EXTENSION_BY_MIME[args.mimeType] ?? "bin";
  const objectPath = `${args.pathPrefix.replace(/\/+$/, "")}/${crypto.randomUUID()}.${extension}`;

  const bucket = getStorage().bucket(BUCKET_NAME);
  const file = bucket.file(objectPath);
  await file.save(args.bytes, {
    contentType: args.mimeType,
    resumable: false,
    metadata: {
      cacheControl: args.mimeType === "application/json" ? "public, max-age=300" : "public, max-age=31536000, immutable",
    },
  });

  return {
    url: `https://storage.googleapis.com/${BUCKET_NAME}/${objectPath}`,
    objectPath,
  };
}

export async function deleteGeneratedMedia(objectPath: string) {
  const normalized = objectPath.replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) throw new Error("Ruta de almacenamiento inválida.");
  await getStorage().bucket(BUCKET_NAME).file(normalized).delete({ ignoreNotFound: true });
}
