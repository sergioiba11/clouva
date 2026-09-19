export type ResumableUploadProgress = {
  uploadedBytes: number;
  totalBytes: number;
  percent: number;
};

function parseConfirmedOffset(rangeHeader: string | null, fallback: number) {
  const match = rangeHeader?.match(/bytes=0-(\d+)/i);
  if (!match) return fallback;
  const lastByte = Number(match[1]);
  return Number.isFinite(lastByte) ? lastByte + 1 : fallback;
}

function xhrPut(params: {
  url: string;
  headers: Record<string, string>;
  body: Blob;
  onProgress?: (loaded: number) => void;
}) {
  return new Promise<{ status: number; range: string | null }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", params.url, true);
    for (const [key, value] of Object.entries(params.headers)) xhr.setRequestHeader(key, value);
    if (params.onProgress) xhr.upload.onprogress = (event) => params.onProgress?.(event.loaded);
    xhr.onload = () => resolve({ status: xhr.status, range: xhr.getResponseHeader("Range") });
    xhr.onerror = () => reject(new Error("Se cortó la conexión con Google Cloud Storage."));
    xhr.onabort = () => reject(new Error("La subida fue cancelada."));
    xhr.send(params.body);
  });
}

export async function uploadFileResumable(params: {
  uploadUrl: string;
  file: File;
  chunkBytes: number;
  onProgress?: (progress: ResumableUploadProgress) => void;
}) {
  const totalBytes = params.file.size;
  const chunkBytes = Math.max(256 * 1024, Math.trunc(params.chunkBytes));
  let uploadedBytes = 0;

  while (uploadedBytes < totalBytes) {
    const start = uploadedBytes;
    const endExclusive = Math.min(totalBytes, start + chunkBytes);
    const endInclusive = endExclusive - 1;
    const chunk = params.file.slice(start, endExclusive);
    const response = await xhrPut({
      url: params.uploadUrl,
      headers: {
        "Content-Type": params.file.type || "application/octet-stream",
        "Content-Range": `bytes ${start}-${endInclusive}/${totalBytes}`,
      },
      body: chunk,
      onProgress: (loaded) => {
        const current = Math.min(totalBytes, start + loaded);
        params.onProgress?.({
          uploadedBytes: current,
          totalBytes,
          percent: totalBytes ? (current / totalBytes) * 100 : 100,
        });
      },
    });

    if (![200, 201, 308].includes(response.status)) {
      throw new Error(`Google Cloud rechazó un bloque del archivo (${response.status}).`);
    }
    uploadedBytes = response.status === 308
      ? parseConfirmedOffset(response.range, endExclusive)
      : totalBytes;
    params.onProgress?.({
      uploadedBytes,
      totalBytes,
      percent: totalBytes ? (uploadedBytes / totalBytes) * 100 : 100,
    });
  }

  return { uploadedBytes, totalBytes };
}
