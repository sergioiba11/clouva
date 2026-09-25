import "server-only";

import {
  detectCommerceIdentifierType,
  normalizeCommerceIdentifier,
  validateCommerceIdentifier,
  type CommerceIdentifierType,
} from "@/lib/commerce/identifiers";

export type DecodedBarcode = {
  value: string;
  type: CommerceIdentifierType;
  confidence: number;
  sourceIndex?: number;
};

// Recortes para atrapar barras chicas en esquinas (como Motorola abajo-derecha).
// Se decodifica sobre el original de GCS, no sobre el thumb comprimido de Gemini.
type Crop = { left: number; top: number; width: number; height: number };

function buildCrops(w: number, h: number): Crop[] {
  const full: Crop = { left: 0, top: 0, width: w, height: h };
  if (w <= 0 || h <= 0) return [full];
  const bottom: Crop = {
    left: 0,
    top: Math.floor(h * 0.5),
    width: w,
    height: Math.ceil(h * 0.5),
  };
  const bottomRight: Crop = {
    left: Math.floor(w * 0.35),
    top: Math.floor(h * 0.5),
    width: Math.ceil(w * 0.65),
    height: Math.ceil(h * 0.5),
  };
  const bottomStrip: Crop = {
    left: 0,
    top: Math.floor(h * 0.68),
    width: w,
    height: Math.ceil(h * 0.32),
  };
  return [full, bottom, bottomRight, bottomStrip];
}

async function decodeOnePixels(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reader: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  luminance: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  BinaryBitmapCtor: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HybridBinarizerCtor: any,
): Promise<string[]> {
  try {
    const bitmap = new BinaryBitmapCtor(new HybridBinarizerCtor(luminance));
    const result = reader.decode(bitmap);
    const text = String(result?.getText?.() ?? "").trim();
    return text ? [text] : [];
  } catch {
    return [];
  }
}

export async function decodeBarcodesFromImageBytes(
  bytes: Buffer,
  sourceIndex?: number,
): Promise<DecodedBarcode[]> {
  const found = new Map<string, DecodedBarcode>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sharpMod: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("sharp");
    sharpMod = mod.default ?? mod;
  } catch {
    return [];
  }
  // ZXing es dependencia transitiva de @zxing/browser. Import dinámico para
  // no romper el build si aún no está hoisteada.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let zxing: any = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("@zxing/library");
    zxing = mod.default ?? mod;
  } catch {
    return [];
  }
  if (!sharpMod || !zxing) return [];

  try {
    const base = sharpMod(bytes);
    const meta = await base.metadata();
    const w = Number(meta.width || 0);
    const h = Number(meta.height || 0);
    if (!w || !h) return [];

    const {
      MultiFormatReader,
      RGBLuminanceSource,
      BinaryBitmap,
      HybridBinarizer,
      DecodeHintType,
      BarcodeFormat,
    } = zxing;

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.ITF,
      BarcodeFormat.QR_CODE,
      BarcodeFormat.DATA_MATRIX,
    ]);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new MultiFormatReader();
    reader.setHints(hints);

    for (const crop of buildCrops(w, h)) {
      // Re-encuadrar y ampliar 2x: las barras de esquina (Motorola) llegan
      // a Gemini pegadas, al lector exacto le llegan nítidas.
      for (const scale of [1, 2]) {
        try {
          const cw = Math.max(1, Math.min(w - crop.left, crop.width));
          const ch = Math.max(1, Math.min(h - crop.top, crop.height));
          if (cw < 40 || ch < 40) continue;
          const targetW = Math.min(2000, cw * scale);
          const { data, info } = await sharpMod(bytes)
            .extract({ left: crop.left, top: crop.top, width: cw, height: ch })
            .resize({ width: targetW, withoutEnlargement: false })
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          const pixels = new Uint8ClampedArray(data);
          const luminance = new RGBLuminanceSource(pixels, info.width, info.height);
          const texts = await decodeOnePixels(reader, luminance, BinaryBitmap, HybridBinarizer);
          for (const raw of texts) {
            const normalized = normalizeCommerceIdentifier(raw);
            if (!normalized || normalized.length < 6 || normalized.length > 512) continue;
            const type = detectCommerceIdentifierType(normalized);
            // Solo aceptar externos válidos. Los EAN/UPC con dígito mal van
            // a la basura en vez de quedar como "confirmados" con 1 dígito mal.
            const validation = validateCommerceIdentifier(type, normalized);
            if (!validation.valid) continue;
            const key = `${type}:${validation.value}`;
            if (!found.has(key)) {
              found.set(key, {
                value: validation.value,
                type,
                confidence: 1,
                ...(sourceIndex != null ? { sourceIndex } : {}),
              });
            }
          }
          // Si el full ya dio un EAN válido, no hace falta seguir escalando.
          if (scale === 1 && found.size > 0 && crop.left === 0 && crop.top === 0) break;
        } catch {
          continue;
        }
      }
      if (found.size >= 3) break;
    }
  } catch {
    return [];
  }
  return Array.from(found.values());
}
