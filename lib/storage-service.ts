import { Storage } from "@google-cloud/storage";

// Unified server-side access point for the avatar/garment permanent-asset
// bucket. Everything that used to call supabase.storage.from("avatars")
// server-side goes through here instead — GCS is now the source of truth
// for this data, Supabase Storage keeps only the pre-migration copy.
// Mirrors the subset of the supabase-js storage API that callers already
// used, so call sites stay a near-mechanical swap.
const BUCKET_NAME = process.env.CLOUVA_AVATARS_BUCKET ?? "clouva-avatars";
const PUBLIC_BASE_URL = `https://storage.googleapis.com/${BUCKET_NAME}`;

let storageClient: Storage | null = null;
function getStorage() {
  if (!storageClient) storageClient = new Storage();
  return storageClient;
}

type UploadBody = Buffer | ArrayBuffer | Blob;

type UploadOptions = {
  contentType?: string;
  cacheControl?: string;
  upsert?: boolean;
};

type ListEntry = {
  name: string;
  id: string | null;
  updated_at: string | null;
};

async function toBuffer(body: UploadBody): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  return Buffer.from(body);
}

function asStorageError(err: unknown) {
  return { message: err instanceof Error ? err.message : String(err) };
}

export const avatarStorage = {
  async upload(path: string, body: UploadBody, options: UploadOptions = {}) {
    const file = getStorage().bucket(BUCKET_NAME).file(path);
    try {
      if (options.upsert === false) {
        const [exists] = await file.exists();
        if (exists) return { error: asStorageError(new Error("El archivo ya existe")) };
      }
      const buffer = await toBuffer(body);
      await file.save(buffer, {
        resumable: false,
        contentType: options.contentType,
        metadata: options.cacheControl ? { cacheControl: options.cacheControl } : undefined,
      });
      return { error: null };
    } catch (err) {
      return { error: asStorageError(err) };
    }
  },

  getPublicUrl(path: string) {
    return { data: { publicUrl: `${PUBLIC_BASE_URL}/${path}` } };
  },

  async download(path: string) {
    try {
      const [buffer] = await getStorage().bucket(BUCKET_NAME).file(path).download();
      return { data: new Blob([Uint8Array.from(buffer)]), error: null };
    } catch (err) {
      return { data: null, error: asStorageError(err) };
    }
  },

  async remove(paths: string[]) {
    try {
      const bucket = getStorage().bucket(BUCKET_NAME);
      await Promise.all(paths.map((p) => bucket.file(p).delete({ ignoreNotFound: true })));
      return { error: null };
    } catch (err) {
      return { error: asStorageError(err) };
    }
  },

  async list(
    prefix: string,
    options: { limit?: number; sortBy?: { column: string; order: "asc" | "desc" } } = {},
  ): Promise<{ data: ListEntry[] | null; error: { message: string } | null }> {
    try {
      const normalizedPrefix = prefix ? `${prefix.replace(/\/$/, "")}/` : "";
      const [files] = await getStorage().bucket(BUCKET_NAME).getFiles({
        prefix: normalizedPrefix || undefined,
        autoPaginate: false,
        maxResults: options.limit ?? 1000,
      });
      let entries: ListEntry[] = files.map((f) => ({
        name: f.name.slice(normalizedPrefix.length),
        id: (f.metadata.generation as string | undefined) ?? f.name,
        updated_at: (f.metadata.updated as string | undefined) ?? null,
      }));
      if (options.sortBy?.column === "updated_at") {
        entries = entries.sort((a, b) => {
          const diff = new Date(a.updated_at ?? 0).getTime() - new Date(b.updated_at ?? 0).getTime();
          return options.sortBy?.order === "desc" ? -diff : diff;
        });
      }
      return { data: entries, error: null };
    } catch (err) {
      return { data: null, error: asStorageError(err) };
    }
  },

  // The backing bucket is public-read, so a "signed" URL is just the public
  // URL — no IAM SignBlob permission needed for the service account.
  async createSignedUrl(path: string, _expiresInSeconds: number) {
    return { data: { signedUrl: `${PUBLIC_BASE_URL}/${path}` }, error: null };
  },
};
