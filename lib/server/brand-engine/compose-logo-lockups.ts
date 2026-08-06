import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseOpenType, type Font as OpenTypeFont } from "opentype.js";
import sharp from "sharp";
import { flattenToColor, removeBackground, toSquare } from "./generate-logo";
import { reconstructLogoVector } from "./vector-reconstruct";
import type { BrandNaming, DetectedLogo, LogoCandidateVariants, LogoLockupStructure, TypographyConfig } from "./types";

const FONT_PATH = path.join(__dirname, "fonts", "ArchivoBlack-Regular.ttf");
let cachedFont: OpenTypeFont | null = null;

function loadFont() {
  if (cachedFont) return cachedFont;
  const buffer = readFileSync(FONT_PATH);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  cachedFont = parseOpenType(arrayBuffer);
  return cachedFont;
}

function textToPath(text: string, fontSizePx: number, trackingPx: number) {
  const font = loadFont();
  const scale = fontSizePx / font.unitsPerEm;
  let x = 0;
  const parts: string[] = [];
  for (const char of Array.from(text)) {
    if (char === " ") {
      x += fontSizePx * 0.4 + trackingPx;
      continue;
    }
    const glyph = font.charToGlyph(char);
    parts.push(glyph.getPath(x, 0, fontSizePx).toPathData(3));
    x += (glyph.advanceWidth ?? font.unitsPerEm * 0.6) * scale + trackingPx;
  }
  const ascent = (font.ascender / font.unitsPerEm) * fontSizePx;
  const descent = (Math.abs(font.descender) / font.unitsPerEm) * fontSizePx;
  return { d: parts.join(" "), width: Math.max(1, x - trackingPx), height: ascent + descent };
}

function applyCase(text: string, uppercase: boolean) {
  return uppercase ? text.toLocaleUpperCase("es-AR") : text;
}

function viewBox(svg: string) {
  const match = svg.match(/viewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*["']/i);
  return match ? { x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]) } : { x: 0, y: 0, width: 1000, height: 1000 };
}

function innerSvg(svg: string) {
  return svg.replace(/^.*?<svg[^>]*>/is, "").replace(/<\/svg>\s*$/is, "");
}

function nestedSvg(svg: string, x: number, y: number, width: number, height: number) {
  const box = viewBox(svg);
  return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${box.x} ${box.y} ${box.width} ${box.height}" preserveAspectRatio="xMidYMid meet">${innerSvg(svg)}</svg>`;
}

function recolorSvg(svg: string, color: string) {
  return svg.replace(/<svg([^>]*)>/i, `<svg$1><style>path,rect,circle,ellipse,polygon,polyline,line{fill:${color}!important;stroke:${color}!important}</style>`);
}

function buildTextPaths(args: { naming: BrandNaming; typography: TypographyConfig }) {
  const name = applyCase(args.naming.displayName, args.typography.uppercase);
  const descriptor = args.naming.descriptor ? applyCase(args.naming.descriptor, args.typography.uppercase) : null;
  return {
    name: textToPath(name, 96, args.typography.primaryTracking),
    descriptor: descriptor ? textToPath(descriptor, 96 * args.typography.descriptorScale, args.typography.descriptorTracking) : null,
  };
}

function buildStackedSvg(symbolSvg: string, naming: BrandNaming, typography: TypographyConfig) {
  const paths = buildTextPaths({ naming, typography });
  const padding = 44;
  const symbolSize = 260;
  const gap = 28;
  const textWidth = Math.max(paths.name.width, paths.descriptor?.width ?? 0);
  const width = Math.max(symbolSize, textWidth) + padding * 2;
  const height = padding * 2 + symbolSize + gap + paths.name.height + (paths.descriptor ? paths.descriptor.height + 14 : 0);
  const symbolX = (width - symbolSize) / 2;
  const nameX = (width - paths.name.width) / 2;
  const nameY = padding + symbolSize + gap + paths.name.height * 0.8;
  const descriptor = paths.descriptor ? `<path data-component="descriptor" d="${paths.descriptor.d}" fill="#ffffff" transform="translate(${(width - paths.descriptor.width) / 2}, ${nameY + paths.descriptor.height + 14})"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${nestedSvg(symbolSvg, symbolX, padding, symbolSize, symbolSize)}<path data-component="wordmark" d="${paths.name.d}" fill="#ffffff" transform="translate(${nameX}, ${nameY})"/>${descriptor}</svg>`;
}

function buildHorizontalSvg(symbolSvg: string, naming: BrandNaming, typography: TypographyConfig) {
  const paths = buildTextPaths({ naming, typography });
  const padding = 40;
  const symbolSize = 220;
  const gap = 34;
  const textHeight = paths.name.height + (paths.descriptor ? paths.descriptor.height + 12 : 0);
  const width = padding * 2 + symbolSize + gap + Math.max(paths.name.width, paths.descriptor?.width ?? 0);
  const height = padding * 2 + Math.max(symbolSize, textHeight);
  const textX = padding + symbolSize + gap;
  const nameY = padding + (Math.max(symbolSize, textHeight) - textHeight) / 2 + paths.name.height * 0.8;
  const descriptor = paths.descriptor ? `<path data-component="descriptor" d="${paths.descriptor.d}" fill="#ffffff" transform="translate(${textX}, ${nameY + paths.descriptor.height + 12})"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${nestedSvg(symbolSvg, padding, padding, symbolSize, symbolSize)}<path data-component="wordmark" d="${paths.name.d}" fill="#ffffff" transform="translate(${textX}, ${nameY})"/>${descriptor}</svg>`;
}

function buildSquareSvg(symbolSvg: string, naming: BrandNaming, typography: TypographyConfig) {
  const paths = buildTextPaths({ naming, typography });
  const width = 1000;
  const height = 1000;
  const nameScale = Math.min(1, 760 / paths.name.width);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${nestedSvg(symbolSvg, 230, 120, 540, 540)}<g transform="translate(500 760) scale(${nameScale}) translate(${-paths.name.width / 2} 0)"><path data-component="wordmark" d="${paths.name.d}" fill="#ffffff"/></g></svg>`;
}

function generatedSymbolDetectedLogo(): DetectedLogo {
  return {
    detected: true,
    confidence: 1,
    primaryBox: { left: 0, top: 0, right: 1000, bottom: 1000 },
    occurrences: [],
    logoType: "symbol",
    visibleText: { primaryName: null, descriptor: null, otherText: [] },
    lockupStructure: { symbolPosition: "integrated", namePosition: "center", descriptorPosition: "none", orientation: "square", nameToDescriptorRatio: 2.5, symbolToWordmarkRatio: 1, letterSpacing: "normal" },
    visualSignature: { silhouette: "símbolo generado", geometry: "vectorizable", symmetry: "variable", strokeWeight: "variable", negativeSpace: "variable", typographyStyle: null, palette: [], complexity: "medium" },
    decomposition: {
      components: [{ kind: "full_lockup", present: true, confidence: 1, box: { left: 0, top: 0, right: 1000, bottom: 1000 }, description: "Símbolo aislado", expectedText: null }],
      foregroundPolarity: "mixed",
      recommendedColorCount: 4,
      backgroundDescription: "fondo de generación",
    },
  };
}

export type LogoLockupSvgSet = {
  symbol: string;
  primary: string;
  horizontal: string;
  vertical: string;
  square: string;
  white: string;
  black: string;
  monochrome: string;
  favicon: string;
};

export async function composeLogoLockupSvgs(args: {
  masterSymbolBytes: Buffer;
  naming: BrandNaming;
  typography: TypographyConfig;
  lockupStructure: LogoLockupStructure | null;
}): Promise<LogoLockupSvgSet> {
  const symbolVector = await reconstructLogoVector({
    referenceBytes: args.masterSymbolBytes,
    detectedLogo: generatedSymbolDetectedLogo(),
    params: { colorCount: 4, paddingPct: 0, backgroundTolerance: 28, localContrastThreshold: 7, minComponentArea: 10, simplifyTolerance: 1.2 },
  });
  const symbol = symbolVector.masterSvg;
  const stacked = buildStackedSvg(symbol, args.naming, args.typography);
  const horizontal = buildHorizontalSvg(symbol, args.naming, args.typography);
  const square = buildSquareSvg(symbol, args.naming, args.typography);
  const primary = args.lockupStructure?.orientation === "horizontal" ? horizontal : stacked;
  return {
    symbol,
    primary,
    horizontal,
    vertical: stacked,
    square,
    white: recolorSvg(primary, "#ffffff"),
    black: recolorSvg(primary, "#000000"),
    monochrome: recolorSvg(primary, "#000000"),
    favicon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${nestedSvg(symbol, 40, 40, 432, 432)}</svg>`,
  };
}

async function render(svg: string, width: number, height: number, background?: string) {
  let pipeline = sharp(Buffer.from(svg)).resize(width, height, { fit: "contain", background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } });
  if (background) pipeline = pipeline.flatten({ background });
  return pipeline.png().toBuffer();
}

export async function composeLogoLockups(args: {
  masterSymbolBytes: Buffer;
  naming: BrandNaming;
  typography: TypographyConfig;
  lockupStructure: LogoLockupStructure | null;
}): Promise<LogoCandidateVariants> {
  const svgs = await composeLogoLockupSvgs(args);
  const [primary, symbol, horizontal, vertical, square, transparent, white, black, favicon] = await Promise.all([
    render(svgs.primary, 1400, 1000, "#0a0a0a"),
    render(svgs.symbol, 1024, 1024, "#0a0a0a"),
    render(svgs.horizontal, 1600, 600, "#0a0a0a"),
    render(svgs.vertical, 1000, 1200, "#0a0a0a"),
    render(svgs.square, 1024, 1024, "#0a0a0a"),
    render(svgs.primary, 1600, 1200),
    render(svgs.white, 1600, 1200),
    render(svgs.black, 1600, 1200),
    render(svgs.favicon, 512, 512),
  ]);
  // Mantener las funciones antiguas ejercitadas por tests y compatibilidad de
  // alpha; las salidas siguen naciendo del SVG, no de nuevas generaciones.
  const cleanTransparent = await removeBackground(transparent);
  return {
    primary: { bytes: primary, mimeType: "image/png" },
    symbol: { bytes: await toSquare(symbol, 1024), mimeType: "image/png" },
    horizontal: { bytes: horizontal, mimeType: "image/png" },
    vertical: { bytes: vertical, mimeType: "image/png" },
    square: { bytes: square, mimeType: "image/png" },
    transparent: { bytes: cleanTransparent, mimeType: "image/png" },
    white: { bytes: await flattenToColor(cleanTransparent, [255, 255, 255]), mimeType: "image/png" },
    black: { bytes: await flattenToColor(cleanTransparent, [0, 0, 0]), mimeType: "image/png" },
    favicon: { bytes: favicon, mimeType: "image/png" },
  };
}
