import sharp from "sharp";
import {
  CREATOR_OBJECT_REFERENCE_ORDER,
  type CreatorObjectReferenceRole,
} from "@/lib/creator-objects";

export const MAX_OBJECT_REFERENCE_SHEET_BYTES = 16 * 1024 * 1024;
export const MIN_OBJECT_REFERENCE_PANEL_SIZE = 512;
export const OBJECT_REFERENCE_SHEET_RATIO = 3;
export const OBJECT_REFERENCE_SHEET_RATIO_TOLERANCE = 0.03;
export const ALLOWED_OBJECT_REFERENCE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type SplitObjectReference = {
  role: CreatorObjectReferenceRole;
  bytes: Buffer;
  width: number;
  height: number;
  mimeType: "image/webp";
  extension: "webp";
};

export function validateObjectReferenceSheetFile(file: Pick<File, "type" | "size">) {
  if (!ALLOWED_OBJECT_REFERENCE_TYPES.has(file.type)) return "La lámina debe estar en PNG, JPG o WEBP.";
  if (file.size <= 0) return "La lámina está vacía.";
  if (file.size > MAX_OBJECT_REFERENCE_SHEET_BYTES) return "La lámina debe pesar como máximo 16 MB.";
  return null;
}

export function validateObjectReferenceSheetDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return "No pudimos leer las dimensiones de la lámina.";
  }
  const ratio = width / height;
  if (Math.abs(ratio - OBJECT_REFERENCE_SHEET_RATIO) > OBJECT_REFERENCE_SHEET_RATIO_TOLERANCE) {
    return `La lámina de objetos debe ser 3:1 (Frente | Espalda | Costado). La actual es ${ratio.toFixed(2)}:1.`;
  }
  if (height < MIN_OBJECT_REFERENCE_PANEL_SIZE) {
    return `Cada vista debe tener al menos ${MIN_OBJECT_REFERENCE_PANEL_SIZE}px de alto.`;
  }
  return null;
}

export async function splitObjectReferenceSheet(source: Buffer): Promise<{
  sourceWidth: number;
  sourceHeight: number;
  references: SplitObjectReference[];
}> {
  const image = sharp(source, { failOn: "error" }).rotate();
  const metadata = await image.metadata();
  const sourceWidth = Number(metadata.width ?? 0);
  const sourceHeight = Number(metadata.height ?? 0);
  const dimensionError = validateObjectReferenceSheetDimensions(sourceWidth, sourceHeight);
  if (dimensionError) throw new Error(dimensionError);

  const baseWidth = Math.floor(sourceWidth / 3);
  const remainder = sourceWidth % 3;
  const widths = CREATOR_OBJECT_REFERENCE_ORDER.map((_, index) => baseWidth + (index < remainder ? 1 : 0));

  let left = 0;
  const references: SplitObjectReference[] = [];
  for (let index = 0; index < CREATOR_OBJECT_REFERENCE_ORDER.length; index += 1) {
    const role = CREATOR_OBJECT_REFERENCE_ORDER[index];
    const width = widths[index];
    const bytes = await image
      .clone()
      .extract({ left, top: 0, width, height: sourceHeight })
      .webp({ quality: 96, smartSubsample: true })
      .toBuffer();
    references.push({ role, bytes, width, height: sourceHeight, mimeType: "image/webp", extension: "webp" });
    left += width;
  }

  return { sourceWidth, sourceHeight, references };
}
