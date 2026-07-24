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

async function loadWithImageElement(file: File): Promise<LoadedImage> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => undefined,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function loadImage(file: File): Promise<LoadedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Some older browsers expose createImageBitmap without supporting imageOrientation.
    }
  }
  return loadWithImageElement(file);
}

function canvasToWebp(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
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

export async function cropAvatarTriptych(file: File): Promise<{
  sourceWidth: number;
  sourceHeight: number;
  references: CroppedAvatarReference[];
}> {
  const loaded = await loadImage(file);
  try {
    const dimensionsError = validateTriptychDimensions(loaded.width, loaded.height);
    if (dimensionsError) throw new Error(dimensionsError);

    const regions = getTriptychCropRegions(loaded.width, loaded.height);
    const references: CroppedAvatarReference[] = [];

    for (const region of regions) {
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

      const blob = await canvasToWebp(canvas);
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

      canvas.width = 1;
      canvas.height = 1;
    }

    return { sourceWidth: loaded.width, sourceHeight: loaded.height, references };
  } finally {
    loaded.close();
  }
}
