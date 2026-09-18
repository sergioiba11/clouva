export type ParsedExifMetadata = {
  orientation: number | null;
  dateTimeOriginal: string | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  gpsHeading: number | null;
};

type Endian = "LE" | "BE";

const TYPE_SIZE: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  7: 1, // UNDEFINED
  9: 4, // SLONG
  10: 8, // SRATIONAL
};

function tiffStart(buffer: Buffer) {
  return buffer.subarray(0, 6).toString("ascii") === "Exif\0\0" ? 6 : 0;
}

function reader(buffer: Buffer, start: number, endian: Endian) {
  const u16 = (offset: number) => {
    const absolute = start + offset;
    if (absolute < 0 || absolute + 2 > buffer.length) throw new Error("EXIF fuera de rango.");
    return endian === "LE" ? buffer.readUInt16LE(absolute) : buffer.readUInt16BE(absolute);
  };
  const u32 = (offset: number) => {
    const absolute = start + offset;
    if (absolute < 0 || absolute + 4 > buffer.length) throw new Error("EXIF fuera de rango.");
    return endian === "LE" ? buffer.readUInt32LE(absolute) : buffer.readUInt32BE(absolute);
  };
  const i32 = (offset: number) => {
    const absolute = start + offset;
    if (absolute < 0 || absolute + 4 > buffer.length) throw new Error("EXIF fuera de rango.");
    return endian === "LE" ? buffer.readInt32LE(absolute) : buffer.readInt32BE(absolute);
  };
  return { u16, u32, i32 };
}

type IfdEntry = {
  tag: number;
  type: number;
  count: number;
  valueFieldOffset: number;
};

function readIfdEntries(buffer: Buffer, start: number, endian: Endian, ifdOffset: number) {
  const { u16, u32 } = reader(buffer, start, endian);
  const count = u16(ifdOffset);
  if (count > 512) throw new Error("EXIF IFD inválido.");
  const entries: IfdEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = ifdOffset + 2 + index * 12;
    entries.push({
      tag: u16(offset),
      type: u16(offset + 2),
      count: u32(offset + 4),
      valueFieldOffset: offset + 8,
    });
  }
  return entries;
}

function valueOffset(buffer: Buffer, start: number, endian: Endian, entry: IfdEntry) {
  const typeSize = TYPE_SIZE[entry.type];
  if (!typeSize || entry.count < 0 || entry.count > 10_000) return null;
  const byteLength = typeSize * entry.count;
  const { u32 } = reader(buffer, start, endian);
  const relative = byteLength <= 4 ? entry.valueFieldOffset : u32(entry.valueFieldOffset);
  const absolute = start + relative;
  if (absolute < start || absolute + byteLength > buffer.length) return null;
  return { relative, absolute, byteLength };
}

function asciiValue(buffer: Buffer, start: number, endian: Endian, entry: IfdEntry) {
  if (entry.type !== 2) return null;
  const location = valueOffset(buffer, start, endian, entry);
  if (!location) return null;
  return buffer
    .subarray(location.absolute, location.absolute + location.byteLength)
    .toString("ascii")
    .replace(/\0+$/g, "")
    .trim() || null;
}

function numericValues(buffer: Buffer, start: number, endian: Endian, entry: IfdEntry) {
  const location = valueOffset(buffer, start, endian, entry);
  if (!location) return [] as number[];
  const values: number[] = [];
  for (let index = 0; index < entry.count; index += 1) {
    const absolute = location.absolute + index * (TYPE_SIZE[entry.type] ?? 1);
    try {
      if (entry.type === 1 || entry.type === 7) values.push(buffer[absolute]);
      else if (entry.type === 3) values.push(endian === "LE" ? buffer.readUInt16LE(absolute) : buffer.readUInt16BE(absolute));
      else if (entry.type === 4) values.push(endian === "LE" ? buffer.readUInt32LE(absolute) : buffer.readUInt32BE(absolute));
      else if (entry.type === 9) values.push(endian === "LE" ? buffer.readInt32LE(absolute) : buffer.readInt32BE(absolute));
      else if (entry.type === 5 || entry.type === 10) {
        const numerator = entry.type === 5
          ? (endian === "LE" ? buffer.readUInt32LE(absolute) : buffer.readUInt32BE(absolute))
          : (endian === "LE" ? buffer.readInt32LE(absolute) : buffer.readInt32BE(absolute));
        const denominator = entry.type === 5
          ? (endian === "LE" ? buffer.readUInt32LE(absolute + 4) : buffer.readUInt32BE(absolute + 4))
          : (endian === "LE" ? buffer.readInt32LE(absolute + 4) : buffer.readInt32BE(absolute + 4));
        values.push(denominator ? numerator / denominator : Number.NaN);
      }
    } catch {
      return [];
    }
  }
  return values.filter(Number.isFinite);
}

function firstNumber(buffer: Buffer, start: number, endian: Endian, entry?: IfdEntry) {
  if (!entry) return null;
  const values = numericValues(buffer, start, endian, entry);
  return values.length ? values[0] : null;
}

function entryByTag(entries: IfdEntry[], tag: number) {
  return entries.find((entry) => entry.tag === tag);
}

function dmsToDecimal(values: number[], ref: string | null) {
  if (values.length < 3) return null;
  const decimal = values[0] + values[1] / 60 + values[2] / 3600;
  return /S|W/i.test(ref ?? "") ? -decimal : decimal;
}

export function parseExifMetadata(exif?: Buffer | null): ParsedExifMetadata {
  const empty: ParsedExifMetadata = {
    orientation: null,
    dateTimeOriginal: null,
    latitude: null,
    longitude: null,
    altitude: null,
    gpsHeading: null,
  };
  if (!exif || exif.length < 14) return empty;

  try {
    const start = tiffStart(exif);
    const byteOrder = exif.subarray(start, start + 2).toString("ascii");
    const endian: Endian = byteOrder === "II" ? "LE" : byteOrder === "MM" ? "BE" : (() => { throw new Error("EXIF endian inválido."); })();
    const { u16, u32 } = reader(exif, start, endian);
    if (u16(2) !== 42) return empty;

    const ifd0Offset = u32(4);
    const ifd0 = readIfdEntries(exif, start, endian, ifd0Offset);
    const orientation = firstNumber(exif, start, endian, entryByTag(ifd0, 0x0112));
    let dateTimeOriginal = asciiValue(exif, start, endian, entryByTag(ifd0, 0x0132) ?? { tag: 0, type: 0, count: 0, valueFieldOffset: 0 });

    const exifPointer = firstNumber(exif, start, endian, entryByTag(ifd0, 0x8769));
    if (exifPointer != null) {
      const exifIfd = readIfdEntries(exif, start, endian, exifPointer);
      dateTimeOriginal = asciiValue(
        exif,
        start,
        endian,
        entryByTag(exifIfd, 0x9003) ?? entryByTag(exifIfd, 0x9004) ?? { tag: 0, type: 0, count: 0, valueFieldOffset: 0 },
      ) ?? dateTimeOriginal;
    }

    let latitude: number | null = null;
    let longitude: number | null = null;
    let altitude: number | null = null;
    let gpsHeading: number | null = null;
    const gpsPointer = firstNumber(exif, start, endian, entryByTag(ifd0, 0x8825));
    if (gpsPointer != null) {
      const gps = readIfdEntries(exif, start, endian, gpsPointer);
      const latRef = asciiValue(exif, start, endian, entryByTag(gps, 0x0001) ?? { tag: 0, type: 0, count: 0, valueFieldOffset: 0 });
      const lonRef = asciiValue(exif, start, endian, entryByTag(gps, 0x0003) ?? { tag: 0, type: 0, count: 0, valueFieldOffset: 0 });
      const latEntry = entryByTag(gps, 0x0002);
      const lonEntry = entryByTag(gps, 0x0004);
      if (latEntry) latitude = dmsToDecimal(numericValues(exif, start, endian, latEntry), latRef);
      if (lonEntry) longitude = dmsToDecimal(numericValues(exif, start, endian, lonEntry), lonRef);

      const altitudeValue = firstNumber(exif, start, endian, entryByTag(gps, 0x0006));
      const altitudeRef = firstNumber(exif, start, endian, entryByTag(gps, 0x0005));
      if (altitudeValue != null) altitude = altitudeRef === 1 ? -altitudeValue : altitudeValue;

      gpsHeading = firstNumber(exif, start, endian, entryByTag(gps, 0x0011));
      if (gpsHeading != null) gpsHeading = ((gpsHeading % 360) + 360) % 360;
    }

    return {
      orientation: orientation != null ? Math.round(orientation) : null,
      dateTimeOriginal,
      latitude,
      longitude,
      altitude,
      gpsHeading,
    };
  } catch {
    return empty;
  }
}
