import { Storage } from "@google-cloud/storage";

// Bucket público para assets generados/reconstruidos que se referencian desde
// Supabase. Auth por ADC del servicio de Cloud Run.
const BUCKET_NAME = process.env.CLOUVA_GENERATED_MEDIA_BUCKET ?? "clouva-generated-media";

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
  "application/pdf": "pdf",
  "application/json": "json",
};

export async function uploadGeneratedMedia(args: {
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

  return `https://storage.googleapis.com/${BUCKET_NAME}/${objectPath}`;
}
