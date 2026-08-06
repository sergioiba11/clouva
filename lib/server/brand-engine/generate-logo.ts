import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { GeminiImageError, generateImage, type GeminiAspectRatio } from "@/lib/gemini-image";
import { finalizeBudget, releaseBudget, reserveBudget } from "@/lib/ai-budget/budget-service";
import { estimateFinalCostUsd, estimateImageCostUsd } from "@/lib/ai-budget/gemini-pricing";
import type { LogoBriefPrompts } from "./build-logo-brief";
import type { LogoCandidateVariants } from "./types";

const MODEL = "gemini-3.1-flash-image";
const RESOLUTION = "1K" as const;

// Mismo patrón reserve->generate->finalize/release que generateLogoAsset()
// en vip-profile-assets.ts -- reutilizado tal cual, no reinventado, solo
// parametrizado por aspectRatio para las 4 variantes reales.
async function generateWithBudget(admin: SupabaseClient, apiKey: string, prompt: string, aspectRatio: GeminiAspectRatio) {
  const estimatedCostUsd = estimateImageCostUsd(MODEL, RESOLUTION);
  const reservation = await reserveBudget(admin, { estimatedCostUsd });
  if (!reservation.allowed) {
    const error = new Error(`Presupuesto no disponible (${reservation.reason}).`);
    (error as Error & { code?: string }).code = "blocked_budget";
    throw error;
  }

  let generated: Awaited<ReturnType<typeof generateImage>>;
  try {
    generated = await generateImage({ apiKey, prompt, model: MODEL, aspectRatio });
  } catch (generationError) {
    await releaseBudget(admin, { estimatedCostUsd });
    if (generationError instanceof GeminiImageError) throw generationError;
    throw generationError instanceof Error ? generationError : new Error("Fallo desconocido generando el logo.");
  }

  const actualCostUsd = estimateFinalCostUsd({
    model: MODEL,
    resolution: RESOLUTION,
    promptTokenCount: generated.usageMetadata?.promptTokenCount,
    candidatesTokenCount: generated.usageMetadata?.candidatesTokenCount,
    thoughtsTokenCount: generated.usageMetadata?.thoughtsTokenCount,
  });
  await finalizeBudget(admin, { estimatedCostUsd, actualCostUsd });

  return { bytes: generated.bytes, mimeType: generated.mimeType, actualCostUsd };
}

// Chroma-key aproximado: el color promedio de las 4 esquinas se trata como
// "fondo" y los píxeles suficientemente parecidos se vuelven transparentes.
// No es matting semántico real (no hay librería de eso instalada -- ver
// plan, fase 2) -- funciona bien acá específicamente porque nuestro propio
// prompt pide "fondo sólido oscuro", no una foto con fondo complejo.
const BACKGROUND_DISTANCE_THRESHOLD = 40;

// Exportadas (además de usarse acá adentro) para poder probarlas solas en
// tests-brand-engine.mjs sin depender de una llamada real a Gemini.
export async function removeBackground(bytes: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const cornerIndexes = [
    0,
    (width - 1) * channels,
    (height - 1) * width * channels,
    ((height - 1) * width + (width - 1)) * channels,
  ];
  let r = 0, g = 0, b = 0;
  for (const idx of cornerIndexes) {
    r += data[idx];
    g += data[idx + 1];
    b += data[idx + 2];
  }
  r /= cornerIndexes.length;
  g /= cornerIndexes.length;
  b /= cornerIndexes.length;

  for (let i = 0; i < data.length; i += channels) {
    const dr = data[i] - r;
    const dg = data[i + 1] - g;
    const db = data[i + 2] - b;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    if (distance < BACKGROUND_DISTANCE_THRESHOLD) data[i + 3] = 0;
  }

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

// Fuerza el RGB a un color sólido preservando el alpha ya calculado por
// removeBackground -- blanco/negro son el mismo símbolo recortado, no una
// regeneración nueva (consistencia real entre variantes, costo $0).
export async function flattenToColor(transparentBytes: Buffer, rgb: [number, number, number]): Promise<Buffer> {
  const { data, info } = await sharp(transparentBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  for (let i = 0; i < data.length; i += channels) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

export async function toSquare(bytes: Buffer, size: number): Promise<Buffer> {
  return sharp(bytes)
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

export async function generateLogoCandidateVariants(args: {
  admin: SupabaseClient;
  apiKey: string;
  prompts: LogoBriefPrompts;
}): Promise<{ variants: LogoCandidateVariants; costUsd: number }> {
  // 4 generaciones reales de Gemini (primary/symbol/horizontal/vertical), en
  // paralelo -- reserveBudget es atómico por llamada (rpc SECURITY DEFINER),
  // seguro correrlas concurrentes. El resto de las variantes del punto 7 del
  // pedido (square/transparent/white/black/favicon) se derivan localmente
  // con sharp a partir de "symbol", $0 de costo y visualmente consistentes
  // entre sí (en vez de pedirle a Gemini que "regenere lo mismo" en cada
  // color, que arriesga inconsistencia real entre variantes).
  const [primary, symbol, horizontal, vertical] = await Promise.all([
    generateWithBudget(args.admin, args.apiKey, args.prompts.primary, "1:1"),
    generateWithBudget(args.admin, args.apiKey, args.prompts.symbol, "1:1"),
    generateWithBudget(args.admin, args.apiKey, args.prompts.horizontal, "16:9"),
    generateWithBudget(args.admin, args.apiKey, args.prompts.vertical, "9:16"),
  ]);

  const transparent = await removeBackground(symbol.bytes);
  const [white, black, square, favicon] = await Promise.all([
    flattenToColor(transparent, [255, 255, 255]),
    flattenToColor(transparent, [0, 0, 0]),
    toSquare(transparent, 1024),
    toSquare(transparent, 128),
  ]);

  const costUsd = primary.actualCostUsd + symbol.actualCostUsd + horizontal.actualCostUsd + vertical.actualCostUsd;

  return {
    variants: {
      primary: { bytes: primary.bytes, mimeType: primary.mimeType },
      symbol: { bytes: symbol.bytes, mimeType: symbol.mimeType },
      horizontal: { bytes: horizontal.bytes, mimeType: horizontal.mimeType },
      vertical: { bytes: vertical.bytes, mimeType: vertical.mimeType },
      square: { bytes: square, mimeType: "image/png" },
      transparent: { bytes: transparent, mimeType: "image/png" },
      white: { bytes: white, mimeType: "image/png" },
      black: { bytes: black, mimeType: "image/png" },
      favicon: { bytes: favicon, mimeType: "image/png" },
    },
    costUsd,
  };
}
