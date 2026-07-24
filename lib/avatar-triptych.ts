export const AVATAR_REFERENCE_ORDER = ["front", "back", "side"] as const;

export type AvatarReferenceRole = (typeof AVATAR_REFERENCE_ORDER)[number];

export const MAX_AVATAR_REFERENCE_BYTES = 8 * 1024 * 1024;
export const TRIPTYCH_MIN_RATIO = 2.85;
export const TRIPTYCH_MAX_RATIO = 3.15;
export const ALLOWED_AVATAR_REFERENCE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type TriptychCropRegion = {
  role: AvatarReferenceRole;
  x: number;
  y: number;
  width: number;
  height: number;
};

export function getTriptychRatio(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  return width / height;
}

export function isValidTriptychRatio(width: number, height: number) {
  const ratio = getTriptychRatio(width, height);
  return ratio >= TRIPTYCH_MIN_RATIO && ratio <= TRIPTYCH_MAX_RATIO;
}

export function validateTriptychDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return "No pudimos leer las dimensiones de la lámina.";
  }
  if (height >= width) {
    return "La lámina debe ser horizontal y contener Frente | Espalda | Costado.";
  }
  if (!isValidTriptychRatio(width, height)) {
    return `La proporción debe ser cercana a 3:1. La imagen actual es ${getTriptychRatio(width, height).toFixed(2)}:1.`;
  }
  return null;
}

export function getTriptychCropRegions(width: number, height: number): TriptychCropRegion[] {
  const error = validateTriptychDimensions(width, height);
  if (error) throw new Error(error);

  const baseWidth = Math.floor(width / 3);
  const remainder = width % 3;
  const widths = AVATAR_REFERENCE_ORDER.map((_, index) => baseWidth + (index < remainder ? 1 : 0));

  let x = 0;
  return AVATAR_REFERENCE_ORDER.map((role, index) => {
    const region = { role, x, y: 0, width: widths[index], height } satisfies TriptychCropRegion;
    x += widths[index];
    return region;
  });
}

export function validateAvatarReferenceFile(file: Pick<File, "type" | "size">, label = "La imagen") {
  if (!ALLOWED_AVATAR_REFERENCE_TYPES.has(file.type)) {
    return `${label} debe estar en formato PNG, JPG o WEBP.`;
  }
  if (file.size <= 0) return `${label} está vacía.`;
  if (file.size > MAX_AVATAR_REFERENCE_BYTES) {
    return `${label} debe pesar como máximo 8 MB.`;
  }
  return null;
}
