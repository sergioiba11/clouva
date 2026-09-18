import { inflateRawSync } from "node:zlib";

export type StructureZipEntry = {
  originalPath: string;
  fileName: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  bytes: Buffer;
};

type CentralEntry = {
  originalPath: string;
  fileName: string;
  mimeType: StructureZipEntry["mimeType"];
  localOffset: number;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_INPUT_ENTRIES = 1200;
const MAX_INPUT_ENTRY_BYTES = 40 * 1024 * 1024;
const MAX_INPUT_EXPANDED_BYTES = 500 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 700 * 1024 * 1024;

function cleanPath(raw: string) {
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) return null;
  if (/^[a-zA-Z]:/.test(segments[0])) return null;
  return segments.join("/");
}

function imageMime(path: string): StructureZipEntry["mimeType"] | null {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  return null;
}

function findEndOfCentralDirectory(bytes: Buffer) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

function inflateEntry(archive: Buffer, entry: CentralEntry) {
  const offset = entry.localOffset;
  if (offset < 0 || offset + 30 > archive.length || archive.readUInt32LE(offset) !== LOCAL_SIGNATURE) {
    throw new Error("El ZIP contiene una entrada inválida.");
  }
  const nameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedSize;
  if (dataEnd > archive.length) throw new Error("El ZIP está incompleto.");
  const compressed = archive.subarray(dataOffset, dataEnd);
  const result = entry.method === 0
    ? Buffer.from(compressed)
    : entry.method === 8
      ? inflateRawSync(compressed)
      : null;
  if (!result) throw new Error(`Método ZIP no soportado (${entry.method}).`);
  if (result.length !== entry.uncompressedSize) throw new Error("El tamaño expandido del ZIP no coincide.");
  return result;
}

export function extractStructureZip(archive: Buffer): StructureZipEntry[] {
  const eocd = findEndOfCentralDirectory(archive);
  if (eocd < 0) throw new Error("No se pudo abrir el ZIP.");
  const entryCount = archive.readUInt16LE(eocd + 10);
  const centralSize = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("ZIP64 todavía no está soportado.");
  }
  if (entryCount > MAX_INPUT_ENTRIES) throw new Error(`El ZIP supera ${MAX_INPUT_ENTRIES} entradas.`);
  if (centralOffset + centralSize > archive.length) throw new Error("El directorio central del ZIP está dañado.");

  const descriptors: CentralEntry[] = [];
  let cursor = centralOffset;
  let expanded = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > archive.length || archive.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error("El directorio central del ZIP es inválido.");
    }
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > archive.length) throw new Error("Nombre inválido dentro del ZIP.");
    const rawName = archive.subarray(nameStart, nameEnd).toString("utf8");
    cursor = nameEnd + extraLength + commentLength;

    const path = cleanPath(rawName);
    if (!path || path.endsWith("/") || /(^|\/)__MACOSX(\/|$)/i.test(path)) continue;
    const fileName = path.split("/").at(-1) ?? path;
    if (fileName.startsWith(".") || /^Thumbs\.db$/i.test(fileName)) continue;
    const mimeType = imageMime(path);
    if (!mimeType) continue;
    if ((flags & 0x1) !== 0) throw new Error("El ZIP contiene entradas cifradas.");
    if (uncompressedSize > MAX_INPUT_ENTRY_BYTES) throw new Error(`${fileName} supera 40 MB.`);
    expanded += uncompressedSize;
    if (expanded > MAX_INPUT_EXPANDED_BYTES) throw new Error("El ZIP supera 500 MB expandido.");

    descriptors.push({
      originalPath: path,
      fileName,
      mimeType,
      localOffset,
      compressedSize,
      uncompressedSize,
      method,
    });
  }

  if (!descriptors.length) throw new Error("El ZIP no contiene JPG, PNG o WEBP.");
  return descriptors.map((descriptor) => ({
    originalPath: descriptor.originalPath,
    fileName: descriptor.fileName,
    mimeType: descriptor.mimeType,
    bytes: inflateEntry(archive, descriptor),
  }));
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = ((date.getHours() & 0x1f) << 11)
    | ((date.getMinutes() & 0x3f) << 5)
    | ((Math.floor(date.getSeconds() / 2)) & 0x1f);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

export function buildZip(entries: Array<{ name: string; bytes: Buffer }>) {
  if (!entries.length) throw new Error("No hay archivos para exportar.");
  if (entries.length > 5000) throw new Error("La exportación supera 5.000 archivos.");

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  let totalDataBytes = 0;
  const { time, day } = dosDateTime();

  for (const entry of entries) {
    const cleanName = cleanPath(entry.name);
    if (!cleanName) throw new Error("La exportación contiene una ruta inválida.");
    const nameBytes = Buffer.from(cleanName, "utf8");
    const data = entry.bytes;
    totalDataBytes += data.length;
    if (totalDataBytes > MAX_OUTPUT_BYTES) throw new Error("El ZIP final supera 700 MB.");
    const checksum = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_SIGNATURE, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(day, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBytes, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(day, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);

    centralParts.push(centralHeader, nameBytes);
    localOffset += localHeader.length + nameBytes.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}
