export const TRIPTYCH_REFERENCE_ORDER = ["front", "back", "side"] as const;
export type TriptychReferenceKey = (typeof TRIPTYCH_REFERENCE_ORDER)[number];

export const TRIPTYCH_MIN_RATIO = 2.85;
export const TRIPTYCH_MAX_RATIO = 3.15;
export const MAX_TRIPTYCH_FILE_BYTES = 8 * 1024 * 1024;
export const TRIPTYCH_ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type TriptychCropRegion = {
  key: TriptychReferenceKey;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TriptychValidation = {
  valid: boolean;
  ratio: number;
  message?: string;
};

export function validateTriptychDimensions(width: number, height: number): TriptychValidation {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { valid: false, ratio: 0, message: "No se pudieron leer las dimensiones de la imagen." };
  }

  const ratio = width / height;
  if (width <= height || ratio < TRIPTYCH_MIN_RATIO || ratio > TRIPTYCH_MAX_RATIO) {
    return {
      valid: false,
      ratio,
      message: "La lámina debe ser horizontal y tener una proporción cercana a 3:1.",
    };
  }

  return { valid: true, ratio };
}

export function calculateTriptychCropRegions(width: number, height: number): TriptychCropRegion[] {
  const validation = validateTriptychDimensions(width, height);
  if (!validation.valid) throw new Error(validation.message);

  const baseWidth = Math.floor(width / 3);
  const remainder = width % 3;
  const widths = [baseWidth, baseWidth, baseWidth];
  for (let index = 0; index < remainder; index += 1) widths[index] += 1;

  let x = 0;
  return TRIPTYCH_REFERENCE_ORDER.map((key, index) => {
    const region = { key, x, y: 0, width: widths[index], height };
    x += widths[index];
    return region;
  });
}

export function validateTriptychFile(file: File): string | null {
  if (!TRIPTYCH_ALLOWED_TYPES.has(file.type)) return "Usá una imagen PNG, JPG o WEBP.";
  if (file.size <= 0) return "La imagen está vacía.";
  if (file.size > MAX_TRIPTYCH_FILE_BYTES) return "La lámina debe pesar como máximo 8 MB.";
  return null;
}

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
};

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Operación cancelada", "AbortError");
}

async function decodeWithImageElement(file: File, signal?: AbortSignal): Promise<DecodedImage> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";

    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new DOMException("Operación cancelada", "AbortError"));
      signal?.addEventListener("abort", abort, { once: true });
      image.onload = () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      image.onerror = () => {
        signal?.removeEventListener("abort", abort);
        reject(new Error("No se pudo abrir la imagen."));
      };
      image.src = objectUrl;
    });

    throwIfAborted(signal);
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function decodeTriptych(file: File, signal?: AbortSignal): Promise<DecodedImage> {
  throwIfAborted(signal);
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (signal?.aborted) {
        bitmap.close();
        throw new DOMException("Operación cancelada", "AbortError");
      }
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => bitmap.close(),
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
    }
  }
  return decodeWithImageElement(file, signal);
}

function canvasToWebp(canvas: HTMLCanvasElement, signal?: AbortSignal) {
  return new Promise<Blob>((resolve, reject) => {
    throwIfAborted(signal);
    canvas.toBlob((blob) => {
      if (signal?.aborted) {
        reject(new DOMException("Operación cancelada", "AbortError"));
        return;
      }
      if (!blob) {
        reject(new Error("No se pudo preparar uno de los recortes."));
        return;
      }
      resolve(blob);
    }, "image/webp", 0.92);
  });
}

export async function cropTriptychReferences(file: File, signal?: AbortSignal) {
  const fileError = validateTriptychFile(file);
  if (fileError) throw new Error(fileError);

  const decoded = await decodeTriptych(file, signal);
  try {
    const regions = calculateTriptychCropRegions(decoded.width, decoded.height);
    const output = [] as Array<{ key: TriptychReferenceKey; file: File; region: TriptychCropRegion }>;

    for (const region of regions) {
      throwIfAborted(signal);
      const canvas = document.createElement("canvas");
      canvas.width = region.width;
      canvas.height = region.height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("No se pudo preparar la vista previa.");
      context.drawImage(
        decoded.source,
        region.x,
        region.y,
        region.width,
        region.height,
        0,
        0,
        region.width,
        region.height,
      );
      const blob = await canvasToWebp(canvas, signal);
      output.push({
        key: region.key,
        file: new File([blob], `avatar-${region.key}.webp`, { type: "image/webp", lastModified: Date.now() }),
        region,
      });
      canvas.width = 0;
      canvas.height = 0;
    }

    return output;
  } finally {
    decoded.dispose();
  }
}
