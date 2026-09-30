"use client";

import { supabase } from "@/lib/supabase";

const BUCKET = "clouva-files";
const CHUNK_SIZE = 6 * 1024 * 1024;

function storageUploadEndpoint() {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  try {
    const url = new URL(configured);
    const projectRef = url.hostname.endsWith(".supabase.co")
      ? url.hostname.slice(0, -".supabase.co".length)
      : "";
    if (projectRef) {
      return `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
    }
  } catch {}
  return `${configured.replace(/\/$/, "")}/storage/v1/upload/resumable`;
}

function base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function uploadMetadata(values: Record<string, string>) {
  return Object.entries(values)
    .map(([key, value]) => `${key} ${base64(value)}`)
    .join(",");
}

function safeFileName(name: string) {
  const cleaned = name
    .replace(/[\\/\u0000-\u001f\u007f]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return (cleaned || "archivo").slice(0, 220);
}

async function authenticatedHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Iniciá sesión para subir archivos.");

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!anonKey) throw new Error("Falta configurar Supabase en el navegador.");

  return {
    authorization: `Bearer ${session.access_token}`,
    apikey: anonKey,
  };
}

async function readRemoteOffset(uploadUrl: string, headers: Record<string, string>) {
  const response = await fetch(uploadUrl, {
    method: "HEAD",
    headers: {
      ...headers,
      "Tus-Resumable": "1.0.0",
    },
  });
  if (!response.ok) throw new Error(`No se pudo reanudar la carga (HTTP ${response.status}).`);
  return Number(response.headers.get("Upload-Offset") ?? 0);
}

export async function uploadClouvaFile(args: {
  userId: string;
  file: File;
  onProgress?: (progress: number) => void;
}) {
  const headers = await authenticatedHeaders();
  const objectPath = `${args.userId}/${crypto.randomUUID()}/${safeFileName(args.file.name)}`;
  const mimeType = args.file.type || "application/octet-stream";
  const endpoint = storageUploadEndpoint();

  const created = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...headers,
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(args.file.size),
      "Upload-Metadata": uploadMetadata({
        bucketName: BUCKET,
        objectName: objectPath,
        contentType: mimeType,
        cacheControl: "3600",
        metadata: JSON.stringify({ originalName: args.file.name }),
      }),
    },
  });

  if (!created.ok) {
    const detail = await created.text().catch(() => "");
    throw new Error(detail || `No se pudo iniciar la carga (HTTP ${created.status}).`);
  }

  const location = created.headers.get("Location");
  if (!location) throw new Error("Supabase no devolvió la URL de carga.");
  const uploadUrl = new URL(location, endpoint).toString();

  let offset = Number(created.headers.get("Upload-Offset") ?? 0);
  args.onProgress?.(args.file.size ? Math.round((offset / args.file.size) * 100) : 100);

  while (offset < args.file.size) {
    let uploaded = false;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 5 && !uploaded; attempt += 1) {
      try {
        const end = Math.min(offset + CHUNK_SIZE, args.file.size);
        const response = await fetch(uploadUrl, {
          method: "PATCH",
          headers: {
            ...headers,
            "Tus-Resumable": "1.0.0",
            "Upload-Offset": String(offset),
            "Content-Type": "application/offset+octet-stream",
          },
          body: args.file.slice(offset, end),
        });

        if (!response.ok) {
          if (response.status === 409) {
            offset = await readRemoteOffset(uploadUrl, headers);
            continue;
          }
          const detail = await response.text().catch(() => "");
          throw new Error(detail || `Falló un bloque de la carga (HTTP ${response.status}).`);
        }

        offset = Number(response.headers.get("Upload-Offset") ?? end);
        args.onProgress?.(Math.min(100, Math.round((offset / args.file.size) * 100)));
        uploaded = true;
      } catch (error) {
        lastError = error;
        if (attempt >= 4) break;
        await new Promise((resolve) => window.setTimeout(resolve, [600, 1500, 3000, 5000][attempt] ?? 5000));
        offset = await readRemoteOffset(uploadUrl, headers).catch(() => offset);
      }
    }

    if (!uploaded) {
      throw lastError instanceof Error ? lastError : new Error("La carga se interrumpió.");
    }
  }

  args.onProgress?.(100);
  return { objectPath, mimeType };
}

export async function removeClouvaFile(storagePath: string) {
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) throw error;
}

export async function signedOwnDownload(storagePath: string, fileName: string) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 90, { download: fileName });
  if (error || !data?.signedUrl) throw error ?? new Error("No se pudo preparar la descarga.");
  return data.signedUrl;
}

export { BUCKET as CLOUVA_FILES_BUCKET };
