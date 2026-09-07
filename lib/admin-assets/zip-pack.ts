import { inflateRawSync } from "node:zlib";

export type AssetPackVariant = "black" | "light" | "adaptive" | "shared";
export type AssetPackPlatform = "canonical" | "png" | "favicon" | "pwa" | "design" | "desktop" | "nextjs" | "android" | "ios" | "other";

export type AssetPackEntry = {
  originalPath: string;
  fileName: string;
  bytes: Buffer;
  variant: AssetPackVariant;
  platform: AssetPackPlatform;
  destinationFolder: string;
  contentType: string;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_ENTRIES = 600;
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 250 * 1024 * 1024;
// ZIP packs are expanded server-side and stored as individual categorized assets.
const KNOWN_PLATFORM_SEGMENTS: Array<[string, AssetPackPlatform]> = [
  ["canonical", "canonical"],
  ["png-transparent", "png"],
  ["web-favicon", "favicon"],
  ["pwa", "pwa"],
  ["design-export", "design"],
  ["desktop", "desktop"],
  ["nextjs-ready", "nextjs"],
  ["android", "android"],
  ["ios-app-icon", "ios"],
];
const SKIPPED_NAMES = new Set(["readme.md", "asset_index.md", "checksums.sha256", ".ds_store"]);

function safeSegment(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._@-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || "asset";
}

function cleanArchivePath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === ".." || segment === ".")) return null;
  if (/^[a-zA-Z]:/.test(segments[0])) return null;
  return segments.join("/");
}

function contentTypeFromPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const types: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    icns: "image/icns",
    webmanifest: "application/manifest+json",
    json: "application/json",
    xml: "application/xml",
    txt: "text/plain",
    css: "text/css",
    pdf: "application/pdf",
    glb: "model/gltf-binary",
    gltf: "model/gltf+json",
    fbx: "application/octet-stream",
    obj: "text/plain",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
  };
  return types[extension] ?? "application/octet-stream";
}

function detectVariant(path: string): AssetPackVariant {
  const value = path.toLowerCase();
  if (/light-on-black/.test(value)) return "light";
  if (/black-on-white/.test(value)) return "black";
  if (/(^|[\/_-])light([\/_\-.]|$)/.test(value)) return "light";
  if (/(^|[\/_-])black([\/_\-.]|$)/.test(value)) return "black";
  if (/currentcolor|adaptive/.test(value) || /(^|\/)favicon\.(svg|ico)$/.test(value)) return "adaptive";
  return "shared";
}

function detectPlatform(path: string) {
  const segments = path.toLowerCase().split("/");
  for (const [segment, platform] of KNOWN_PLATFORM_SEGMENTS) {
    const index = segments.indexOf(segment);
    if (index >= 0) return { platform, index };
  }
  return { platform: "other" as const, index: -1 };
}

function classifyPath(path: string) {
  const rawSegments = path.split("/");
  const { platform, index } = detectPlatform(path);
  const variant = detectVariant(path);
  const nested = index >= 0 ? rawSegments.slice(index + 1, -1).map(safeSegment).filter(Boolean) : [];
  const destinationFolder = ["brand", "clouva-logo", variant, platform, ...nested].join("/");
  return { variant, platform, destinationFolder };
}

function findEndOfCentralDirectory(bytes: Buffer) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function inflateEntry(archive: Buffer, localOffset: number, compressedSize: number, method: number, expectedSize: number) {
  if (localOffset < 0 || localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
    throw new Error("El ZIP contiene una entrada inválida.");
  }
  const fileNameLength = archive.readUInt16LE(localOffset + 26);
  const extraLength = archive.readUInt16LE(localOffset + 28);
  const dataOffset = localOffset + 30 + fileNameLength + extraLength;
  const dataEnd = dataOffset + compressedSize;
  if (dataOffset < 0 || dataEnd > archive.length) throw new Error("El ZIP está incompleto o dañado.");
  const compressed = archive.subarray(dataOffset, dataEnd);
  let result: Buffer;
  if (method === 0) result = Buffer.from(compressed);
  else if (method === 8) result = inflateRawSync(compressed);
  else throw new Error(`El ZIP usa un método de compresión no soportado (${method}).`);
  if (result.length !== expectedSize) throw new Error("El tamaño expandido de una entrada del ZIP no coincide.");
  return result;
}

export function extractAssetPack(archive: Buffer): AssetPackEntry[] {
  const eocd = findEndOfCentralDirectory(archive);
  if (eocd < 0) throw new Error("No se pudo abrir el ZIP.");

  const entryCount = archive.readUInt16LE(eocd + 10);
  const centralSize = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("Los ZIP64 no están soportados en el agregador de assets.");
  }
  if (entryCount > MAX_ENTRIES) throw new Error(`El ZIP supera el máximo de ${MAX_ENTRIES} archivos.`);
  if (centralOffset + centralSize > archive.length) throw new Error("El directorio central del ZIP está dañado.");

  const entries: AssetPackEntry[] = [];
  let expandedBytes = 0;
  let cursor = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > archive.length || archive.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error("El directorio central del ZIP contiene una entrada inválida.");
    }

    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const fileNameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > archive.length) throw new Error("El ZIP contiene un nombre de archivo inválido.");

    const originalName = archive.subarray(nameStart, nameEnd).toString("utf8");
    cursor = nameEnd + extraLength + commentLength;
    const cleanPath = cleanArchivePath(originalName);
    if (!cleanPath || cleanPath.endsWith("/")) continue;

    const fileName = cleanPath.split("/").at(-1) ?? cleanPath;
    if (SKIPPED_NAMES.has(fileName.toLowerCase()) || fileName.startsWith(".")) continue;
    if ((flags & 0x1) !== 0) throw new Error("El ZIP contiene archivos cifrados y no se puede importar.");
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error(`El archivo ${fileName} supera 50 MB expandido.`);

    expandedBytes += uncompressedSize;
    if (expandedBytes > MAX_EXPANDED_BYTES) throw new Error("El ZIP supera 250 MB una vez expandido.");

    const bytes = inflateEntry(archive, localOffset, compressedSize, method, uncompressedSize);
    const classification = classifyPath(cleanPath);
    entries.push({
      originalPath: cleanPath,
      fileName: safeSegment(fileName),
      bytes,
      contentType: contentTypeFromPath(cleanPath),
      ...classification,
    });
  }

  if (!entries.length) throw new Error("El ZIP no contiene assets importables.");
  return entries;
}
