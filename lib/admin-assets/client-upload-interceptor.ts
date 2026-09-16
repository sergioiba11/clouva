type AssetZipUploadResult = {
  ok: true;
  kind: "asset-pack";
  imported: number;
  asset: null;
};

type AssetZipUploadHandler = (input: {
  file: File;
  destinationFolder: string;
}) => Promise<AssetZipUploadResult>;

let handler: AssetZipUploadHandler | null = null;

export function registerAssetZipUploadHandler(next: AssetZipUploadHandler) {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

function requestPath(input: RequestInfo | URL) {
  if (typeof input === "string") {
    try {
      return new URL(input, typeof window !== "undefined" ? window.location.origin : "https://clouva.com.ar").pathname;
    } catch {
      return input.split("?")[0];
    }
  }
  if (input instanceof URL) return input.pathname;
  try {
    return new URL(input.url).pathname;
  } catch {
    return input.url.split("?")[0];
  }
}

function isZip(file: File) {
  return file.name.toLowerCase().endsWith(".zip") || /(?:^|\/)zip(?:$|[-+])/i.test(file.type);
}

export async function maybeInterceptAssetZipUpload(input: RequestInfo | URL, init: RequestInit) {
  if (!handler || typeof window === "undefined" || typeof File === "undefined") return null;
  if ((init.method ?? "GET").toUpperCase() !== "POST") return null;
  if (requestPath(input) !== "/api/admin/assets") return null;
  if (!(init.body instanceof FormData)) return null;

  const rawFile = init.body.get("file");
  if (!(rawFile instanceof File) || !isZip(rawFile)) return null;

  const result = await handler({
    file: rawFile,
    destinationFolder: String(init.body.get("folder") ?? "uploads"),
  });

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "X-Clouva-Asset-Import": "persistent",
    },
  });
}
