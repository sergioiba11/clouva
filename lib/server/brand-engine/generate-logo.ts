import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { GeminiImageError, generateImage, type GeminiAspectRatio } from "@/lib/gemini-image";
import { finalizeBudget, releaseBudget, reserveBudget } from "@/lib/ai-budget/budget-service";
import { estimateFinalCostUsd, estimateImageCostUsd } from "@/lib/ai-budget/gemini-pricing";

const MODEL = "gemini-3.1-flash-image";
const RESOLUTION = "1K" as const;

// Mismo patrón reserve->generate->finalize/release que el resto del pipeline
// VIP (vip-profile-assets.ts) -- reutilizado tal cual.
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
    throw generationError instanceof Error ? generationError : new Error("Fallo desconocido generando el símbolo.");
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

// V2: UNA sola generación real de Gemini por corrida -- el masterSymbol,
// aislado, sin texto. Antes eran 4 generaciones independientes (primary/
// symbol/horizontal/vertical), cada una con su propia interpretación --
// perdía la coherencia entre variantes y, más grave, Gemini terminaba
// escribiendo el texto él mismo (mal). El wordmark ahora se compone aparte
// (compose-logo-lockups.ts) a partir de este único símbolo.
export async function generateMasterSymbol(args: { admin: SupabaseClient; apiKey: string; prompt: string }): Promise<{ bytes: Buffer; mimeType: string; costUsd: number }> {
  const result = await generateWithBudget(args.admin, args.apiKey, args.prompt, "1:1");
  return { bytes: result.bytes, mimeType: result.mimeType, costUsd: result.actualCostUsd };
}

// Chroma-key aproximado: el color promedio de las 4 esquinas se trata como
// "fondo" y los píxeles suficientemente parecidos se vuelven transparentes.
// No es matting semántico real (no hay librería de eso instalada) -- funciona
// bien acá específicamente porque nuestro propio prompt pide "fondo sólido
// oscuro", no una foto con fondo complejo.
const BACKGROUND_DISTANCE_THRESHOLD = 40;

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
// regeneración nueva.
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
