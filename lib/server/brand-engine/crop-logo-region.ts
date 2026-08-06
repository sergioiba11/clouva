import "server-only";
import sharp from "sharp";
import type { NormalizedBox } from "./types";

export type PixelBox = { left: number; top: number; width: number; height: number };

// Convierte un box normalizado 0-1000 (mismo formato que layout-config.ts:
// {top,left,bottom,right} relativo a TODA la imagen) a coordenadas de píxel
// reales, con padding para no cortar letras/símbolos que sobresalgan de la
// caja que Gemini estimó. Pura -- separada de cropLogoRegion() para poder
// probar la matemática sin necesitar sharp/una imagen real.
export function normalizedBoxToPixelBox(box: NormalizedBox, imageWidth: number, imageHeight: number, paddingPct = 0.15): PixelBox {
  const leftPx = (imageWidth * box.left) / 1000;
  const topPx = (imageHeight * box.top) / 1000;
  const rightPx = (imageWidth * box.right) / 1000;
  const bottomPx = (imageHeight * box.bottom) / 1000;

  const boxWidth = Math.max(0, rightPx - leftPx);
  const boxHeight = Math.max(0, bottomPx - topPx);
  const padX = boxWidth * paddingPct;
  const padY = boxHeight * paddingPct;

  const clampedLeft = Math.max(0, Math.round(leftPx - padX));
  const clampedTop = Math.max(0, Math.round(topPx - padY));
  const clampedRight = Math.min(imageWidth, Math.round(rightPx + padX));
  const clampedBottom = Math.min(imageHeight, Math.round(bottomPx + padY));

  return {
    left: clampedLeft,
    top: clampedTop,
    width: Math.max(1, clampedRight - clampedLeft),
    height: Math.max(1, clampedBottom - clampedTop),
  };
}

// Recorta la región real del logo detectado en la imagen de referencia --
// antes solo se le mandaba al generador una DESCRIPCIÓN del logo (analyze-
// logo-source.ts), nunca sus píxeles reales. Devuelve el recorte como PNG,
// con margen (padding) prudente para no cortar el símbolo o el texto.
export async function cropLogoRegion(args: {
  referenceBytes: Buffer;
  normalizedBox: NormalizedBox;
  paddingPct?: number;
}): Promise<Buffer> {
  const image = sharp(args.referenceBytes);
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height) throw new Error("No se pudo leer las dimensiones de la imagen de referencia.");

  const pixelBox = normalizedBoxToPixelBox(args.normalizedBox, width, height, args.paddingPct);

  return sharp(args.referenceBytes)
    .extract({ left: pixelBox.left, top: pixelBox.top, width: pixelBox.width, height: pixelBox.height })
    .png()
    .toBuffer();
}
