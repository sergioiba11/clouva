import { Storage } from "@google-cloud/storage";

// Public-read bucket for AI-generated media (Gemini image gen output) that
// gets referenced from Supabase rows (studios.cover_url, gallery items, etc.)
// -- separate from the Analyzer's private run-cache bucket. Auth is via the
// Cloud Run service's attached service account (ADC), no key file needed.
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
  });

  return `https://storage.googleapis.com/${BUCKET_NAME}/${objectPath}`;
}
