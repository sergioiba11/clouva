import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseOpenType, type Font as OpenTypeFont } from "opentype.js";
import sharp from "sharp";
import { flattenToColor, removeBackground, toSquare } from "./generate-logo";
import type { BrandNaming, LogoCandidateVariants, LogoLockupStructure, TypographyConfig } from "./types";

// Fase 5: el wordmark NUNCA lo escribe Gemini -- se compone acá,
// determinísticamente, con una fuente real embebida (probado: intentar
// @font-face con una fuente en base64 dentro del SVG NO funciona de forma
// confiable con sharp/librsvg, cae a una fuente del sistema sin avisar --
// por eso el texto se convierte a paths de verdad con opentype.js antes de
// llegar a sharp, cero dependencia de fuentes instaladas en el runtime).
const FONT_PATH = path.join(__dirname, "fonts", "ArchivoBlack-Regular.ttf");

let cachedFont: OpenTypeFont | null = null;
function loadFont(): OpenTypeFont {
  if (cachedFont) return cachedFont;
  const buffer = readFileSync(FONT_PATH);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  cachedFont = parseOpenType(arrayBuffer);
  return cachedFont;
}

// Convierte texto a un único <path> SVG (glyph por glyph, con tracking
// manual) -- nunca <text>, para no depender de qué fuentes tenga instaladas
// el contenedor donde corra esto.
function textToPath(text: string, fontSizePx: number, trackingPx: number): { d: string; width: number; height: number } {
  const font = loadFont();
  const scale = fontSizePx / font.unitsPerEm;
  let x = 0;
  const parts: string[] = [];
  for (const ch of Array.from(text)) {
    if (ch === " ") {
      x += fontSizePx * 0.4 + trackingPx;
      continue;
    }
    const glyph = font.charToGlyph(ch);
    parts.push(glyph.getPath(x, 0, fontSizePx).toPathData(3));
    x += (glyph.advanceWidth ?? font.unitsPerEm * 0.6) * scale + trackingPx;
  }
  const ascent = (font.ascender / font.unitsPerEm) * fontSizePx;
  const descent = (Math.abs(font.descender) / font.unitsPerEm) * fontSizePx;
  return { d: parts.join(" "), width: Math.max(1, x - trackingPx), height: ascent + descent };
}

function applyCase(text: string, uppercase: boolean): string {
  return uppercase ? text.toLocaleUpperCase("es-AR") : text;
}

async function toPngDataUri(bytes: Buffer): Promise<string> {
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

// Composición base compartida por primary/horizontal/vertical/transparent/
// white/black -- todas usan EXACTAMENTE el mismo símbolo, la misma fuente,
// el mismo texto; solo cambia el layout (posición relativa) y si hay fondo
// sólido o no. `layout` decide dónde va cada pieza.
async function renderLockupSvg(args: {
  symbolDataUri: string;
  symbolAspect: number; // width/height del símbolo transparente
  displayName: string;
  descriptor: string | null;
  typography: TypographyConfig;
  layout: "stacked" | "horizontal-row" | "symbol-only" | "symbol-plus-name";
  backgroundColor: string | null; // null = transparente
  textColor: string;
}): Promise<Buffer> {
  const { typography } = args;
  const name = applyCase(args.displayName, typography.uppercase);
  const descriptor = args.descriptor ? applyCase(args.descriptor, typography.uppercase) : null;

  const namePath = textToPath(name, 96, typography.primaryTracking);
  const descriptorPath = descriptor ? textToPath(descriptor, 96 * typography.descriptorScale, typography.descriptorTracking) : null;

  const symbolSize = 140;
  const padding = 40;
  const gap = 24;

  let canvasWidth: number;
  let canvasHeight: number;
  const pieces: string[] = [];

  if (args.layout === "symbol-only") {
    canvasWidth = symbolSize + padding * 2;
    canvasHeight = symbolSize + padding * 2;
    pieces.push(`<image href="${args.symbolDataUri}" x="${padding}" y="${padding}" width="${symbolSize}" height="${symbolSize}"/>`);
  } else if (args.layout === "horizontal-row") {
    const textBlockHeight = namePath.height + (descriptorPath ? descriptorPath.height + 8 : 0);
    const symbolH = Math.max(textBlockHeight, symbolSize);
    const symbolW = symbolH * args.symbolAspect;
    canvasWidth = padding * 2 + symbolW + gap + Math.max(namePath.width, descriptorPath?.width ?? 0);
    canvasHeight = padding * 2 + symbolH;
    pieces.push(`<image href="${args.symbolDataUri}" x="${padding}" y="${padding}" width="${symbolW}" height="${symbolH}"/>`);
    const textX = padding + symbolW + gap;
    // Y del baseline del nombre: arranca al tope del bloque de texto
    // (centrado verticalmente contra el símbolo) + su propia porción de
    // ascenso -- mismo patrón que el layout "stacked" de abajo, nunca restar
    // ese offset después de sumarlo (bug real encontrado acá: el texto
    // quedaba cortado arriba del canvas).
    const nameBaselineY = padding + (symbolH - textBlockHeight) / 2 + namePath.height * 0.8;
    pieces.push(`<path d="${namePath.d}" fill="${args.textColor}" transform="translate(${textX}, ${nameBaselineY})"/>`);
    if (descriptorPath) {
      pieces.push(`<path d="${descriptorPath.d}" fill="${args.textColor}" transform="translate(${textX}, ${nameBaselineY + descriptorPath.height + 8})"/>`);
    }
  } else if (args.layout === "symbol-plus-name") {
    const textWidth = namePath.width;
    canvasWidth = padding * 2 + Math.max(symbolSize, textWidth);
    canvasHeight = padding * 2 + symbolSize + gap + namePath.height;
    pieces.push(`<image href="${args.symbolDataUri}" x="${(canvasWidth - symbolSize) / 2}" y="${padding}" width="${symbolSize}" height="${symbolSize}"/>`);
    const nameX = (canvasWidth - textWidth) / 2;
    pieces.push(`<path d="${namePath.d}" fill="${args.textColor}" transform="translate(${nameX}, ${padding + symbolSize + gap + namePath.height * 0.8})"/>`);
  } else {
    // stacked: símbolo arriba, nombre grande centrado, descriptor chico
    // centrado debajo -- el layout "principal" pedido explícitamente
    // ([símbolo] / IGLÚ / RECORDS).
    const textWidth = Math.max(namePath.width, descriptorPath?.width ?? 0);
    canvasWidth = padding * 2 + Math.max(symbolSize, textWidth);
    canvasHeight = padding * 2 + symbolSize + gap + namePath.height + (descriptorPath ? descriptorPath.height + 8 : 0);
    pieces.push(`<image href="${args.symbolDataUri}" x="${(canvasWidth - symbolSize) / 2}" y="${padding}" width="${symbolSize}" height="${symbolSize}"/>`);
    const nameX = (canvasWidth - namePath.width) / 2;
    const nameY = padding + symbolSize + gap + namePath.height * 0.8;
    pieces.push(`<path d="${namePath.d}" fill="${args.textColor}" transform="translate(${nameX}, ${nameY})"/>`);
    if (descriptorPath) {
      const descX = (canvasWidth - descriptorPath.width) / 2;
      pieces.push(`<path d="${descriptorPath.d}" fill="${args.textColor}" transform="translate(${descX}, ${nameY + descriptorPath.height + 8})"/>`);
    }
  }

  const background = args.backgroundColor ? `<rect width="${canvasWidth}" height="${canvasHeight}" fill="${args.backgroundColor}"/>` : "";
  const svg = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${background}${pieces.join("")}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// Construye las 9 variantes desde el mismo masterSymbol + el mismo texto --
// nunca una regeneración nueva por variante, solo composición/escala/color
// distintos. Es el único lugar que produce el wordmark final.
export async function composeLogoLockups(args: {
  masterSymbolBytes: Buffer;
  naming: BrandNaming;
  typography: TypographyConfig;
  lockupStructure: LogoLockupStructure | null;
}): Promise<LogoCandidateVariants> {
  const transparentSymbol = await removeBackground(args.masterSymbolBytes);
  const symbolMeta = await sharp(transparentSymbol).metadata();
  const symbolAspect = (symbolMeta.width ?? 1) / (symbolMeta.height ?? 1);
  const symbolDataUri = await toPngDataUri(transparentSymbol);

  const backgroundColor = "#0a0a0a";
  // El mockup define la orientación real del lockup principal (Fase 5,
  // "CLOUVA no decide estructura") -- por default "stacked" (símbolo arriba,
  // nombre, descriptor debajo), pero si el mockup era horizontal se respeta.
  const primaryLayout = args.lockupStructure?.orientation === "horizontal" ? "horizontal-row" : "stacked";

  const [primary, vertical, horizontal, square] = await Promise.all([
    renderLockupSvg({ symbolDataUri, symbolAspect, displayName: args.naming.displayName, descriptor: args.naming.descriptor, typography: args.typography, layout: primaryLayout, backgroundColor, textColor: "#ffffff" }),
    renderLockupSvg({ symbolDataUri, symbolAspect, displayName: args.naming.displayName, descriptor: args.naming.descriptor, typography: args.typography, layout: "stacked", backgroundColor, textColor: "#ffffff" }),
    renderLockupSvg({ symbolDataUri, symbolAspect, displayName: args.naming.displayName, descriptor: args.naming.descriptor, typography: args.typography, layout: "horizontal-row", backgroundColor, textColor: "#ffffff" }),
    renderLockupSvg({ symbolDataUri, symbolAspect, displayName: args.naming.displayName, descriptor: null, typography: args.typography, layout: "symbol-plus-name", backgroundColor, textColor: "#ffffff" }),
  ]);

  const transparent = await renderLockupSvg({ symbolDataUri, symbolAspect, displayName: args.naming.displayName, descriptor: args.naming.descriptor, typography: args.typography, layout: primaryLayout, backgroundColor: null, textColor: "#ffffff" });
  const symbolOnly = await toSquare(transparentSymbol, 512);
  const favicon = await toSquare(transparentSymbol, 128);

  const [white, black] = await Promise.all([
    flattenToColor(await removeBackground(transparent), [255, 255, 255]),
    flattenToColor(await removeBackground(transparent), [0, 0, 0]),
  ]);

  return {
    primary: { bytes: primary, mimeType: "image/png" },
    symbol: { bytes: symbolOnly, mimeType: "image/png" },
    horizontal: { bytes: horizontal, mimeType: "image/png" },
    vertical: { bytes: vertical, mimeType: "image/png" },
    square: { bytes: square, mimeType: "image/png" },
    transparent: { bytes: transparent, mimeType: "image/png" },
    white: { bytes: white, mimeType: "image/png" },
    black: { bytes: black, mimeType: "image/png" },
    favicon: { bytes: favicon, mimeType: "image/png" },
  };
}
