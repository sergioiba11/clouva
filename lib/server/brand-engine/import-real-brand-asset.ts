import "server-only";
import sharp from "sharp";
import { cropLogoRegion } from "./crop-logo-region";
import { flattenToColor, removeBackground } from "./generate-logo";
import type {
  ExtractionMethod,
  ImportedBrandMaster,
  ImportedBrandParts,
  LogoCandidateVariants,
  NormalizedBox,
} from "./types";

async function cornersAreUniform(bytes: Buffer): Promise<boolean> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const points = [
    0,
    (width - 1) * channels,
    (height - 1) * width * channels,
    ((height - 1) * width + (width - 1)) * channels,
  ];
  const samples = points.map((index) => [data[index], data[index + 1], data[index + 2], data[index + 3]]);
  let maxDistance = 0;
  for (let i = 0; i < samples.length; i += 1) {
    for (let j = i + 1; j < samples.length; j += 1) {
      const distance = Math.sqrt(samples[i].reduce((sum, value, channel) => sum + (value - samples[j][channel]) ** 2, 0));
      maxDistance = Math.max(maxDistance, distance);
    }
  }
  return maxDistance <= 32;
}

async function containCanvas(bytes: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(bytes)
    .resize(width, height, { fit: "contain", withoutEnlargement: false, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

export async function importRealBrandAsset(args: {
  referenceBytes: Buffer;
  sourceImageUrl?: string | null;
  sourceBox: NormalizedBox;
  extractionMethod: ExtractionMethod;
}): Promise<{ master: ImportedBrandMaster; parts: ImportedBrandParts; variants: LogoCandidateVariants }> {
  // Padding bajo y controlado: el área ya fue confirmada por el usuario o
  // por la detección compacta. No queremos volver a incluir hero/botones.
  const originalBytes = await cropLogoRegion({
    referenceBytes: args.referenceBytes,
    normalizedBox: args.sourceBox,
    paddingPct: 0.04,
  });

  const metadata = await sharp(originalBytes).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) throw new Error("No se pudo leer el recorte de la identidad real.");

  // La limpieza es técnica y best-effort. Si las esquinas no son uniformes,
  // preservar el recorte tal cual es más seguro que borrar partes del logo.
  const cleanedBytes = await cornersAreUniform(originalBytes)
    ? await removeBackground(originalBytes)
    : await sharp(originalBytes).ensureAlpha().png().toBuffer();

  const [white, black, square, favicon, horizontal, vertical] = await Promise.all([
    flattenToColor(cleanedBytes, [255, 255, 255]),
    flattenToColor(cleanedBytes, [0, 0, 0]),
    containCanvas(cleanedBytes, 1024, 1024),
    containCanvas(cleanedBytes, 256, 256),
    containCanvas(cleanedBytes, 1600, 600),
    containCanvas(cleanedBytes, 800, 1200),
  ]);

  // En esta primera importación confirmada no se inventa un símbolo separado.
  // Hasta que exista un recorte independiente confirmado, symbol/favicon usan
  // el lockup completo con contain, sin modificar tipografía ni geometría.
  const parts: ImportedBrandParts = {
    fullLockup: originalBytes,
    standaloneSymbol: null,
    wordmark: null,
  };

  return {
    master: {
      originalBytes,
      cleanedBytes,
      mimeType: "image/png",
      width,
      height,
      sourceImageUrl: args.sourceImageUrl ?? null,
      sourceBox: args.sourceBox,
      extractionMethod: args.extractionMethod,
    },
    parts,
    variants: {
      primary: { bytes: originalBytes, mimeType: "image/png" },
      symbol: { bytes: square, mimeType: "image/png" },
      horizontal: { bytes: horizontal, mimeType: "image/png" },
      vertical: { bytes: vertical, mimeType: "image/png" },
      square: { bytes: square, mimeType: "image/png" },
      transparent: { bytes: cleanedBytes, mimeType: "image/png" },
      white: { bytes: white, mimeType: "image/png" },
      black: { bytes: black, mimeType: "image/png" },
      favicon: { bytes: favicon, mimeType: "image/png" },
    },
  };
}
