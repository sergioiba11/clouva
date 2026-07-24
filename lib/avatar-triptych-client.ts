import {
  getTriptychCropRegions,
  validateTriptychDimensions,
  type AvatarReferenceRole,
} from "@/lib/avatar-triptych";

type LoadedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
};

export type CroppedAvatarReference = {
  role: AvatarReferenceRole;
  file: File;
  width: number;
  height: number;
};

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

async function loadWithImageElement(file: File, signal?: AbortSignal): Promise<LoadedImage> {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";

  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        image.onload = null;
        image.onerror = null;
      };
      const abort = () => {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      image.onload = () => {
        signal?.removeEventListener("abort", abort);
        cleanup();
        resolve();
      };
      image.onerror = () => {
        signal?.removeEventListener("abort", abort);
        cleanup();
        reject(new Error("No pudimos abrir la lámina."));
      };
      image.src = objectUrl;
    });
    throwIfAborted(signal);

    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => {
        image.src = "";
        URL.revokeObjectURL(objectUrl);
      },
    };
  } catch (error) {
    image.src = "";
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function loadImage(file: File, signal?: AbortSignal): Promise<LoadedImage> {
  throwIfAborted(signal);
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      if (signal?.aborted) {
        bitmap.close();
        throw new DOMException("Aborted", "AbortError");
      }
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      // Some older browsers expose createImageBitmap without supporting imageOrientation.
    }
  }
  return loadWithImageElement(file, signal);
}

function canvasToWebp(canvas: HTMLCanvasElement, signal?: AbortSignal) {
  return new Promise<Blob>((resolve, reject) => {
    throwIfAborted(signal);
    canvas.toBlob(
      (blob) => {
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        if (!blob) {
          reject(new Error("No pudimos preparar las tres vistas de la lámina."));
          return;
        }
        if (blob.type !== "image/webp") {
          reject(new Error("Este navegador no puede exportar las vistas en WEBP."));
          return;
        }
        resolve(blob);
      },
      "image/webp",
      0.94,
    );
  });
}

export async function cropAvatarTriptych(file: File, signal?: AbortSignal): Promise<{
  sourceWidth: number;
  sourceHeight: number;
  references: CroppedAvatarReference[];
}> {
  const loaded = await loadImage(file, signal);
  try {
    throwIfAborted(signal);
    const dimensionsError = validateTriptychDimensions(loaded.width, loaded.height);
    if (dimensionsError) throw new Error(dimensionsError);

    const regions = getTriptychCropRegions(loaded.width, loaded.height);
    const references: CroppedAvatarReference[] = [];

    for (const region of regions) {
      throwIfAborted(signal);
      const canvas = document.createElement("canvas");
      canvas.width = region.width;
      canvas.height = region.height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("No pudimos preparar las vistas de la lámina.");

      context.drawImage(
        loaded.source,
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
      const filename = {
        front: "avatar-front.webp",
        back: "avatar-back.webp",
        side: "avatar-side.webp",
      }[region.role];

      references.push({
        role: region.role,
        width: region.width,
        height: region.height,
        file: new File([blob], filename, { type: "image/webp", lastModified: Date.now() }),
      });

      canvas.width = 0;
      canvas.height = 0;
    }

    throwIfAborted(signal);
    return { sourceWidth: loaded.width, sourceHeight: loaded.height, references };
  } finally {
    loaded.close();
  }
}
