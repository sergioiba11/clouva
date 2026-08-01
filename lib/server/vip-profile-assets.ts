import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GeminiImageError, generateImage, type GeminiReferenceImage } from "@/lib/gemini-image";
import { uploadGeneratedMedia } from "@/lib/gcs-media";
import { finalizeBudget, releaseBudget, reserveBudget } from "@/lib/ai-budget/budget-service";
import { estimateFinalCostUsd, estimateImageCostUsd } from "@/lib/ai-budget/gemini-pricing";
import type { ProfileCopy } from "@/lib/server/vip-profile-gemini";

const MODEL = "gemini-3.1-flash-image";
const RESOLUTION = "1K" as const;

export type GeneratedAsset = { kind: "cover" | "logo"; url: string; costUsd: number };

const REFERENCE_MIME_BY_EXTENSION: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

// Reference image URLs were already validated (server-controlled shape,
// belt-and-suspenders against SSRF) before being stored on the job by
// /api/vip-profile/generate -- fetching them here is safe. Failures are
// swallowed per-image (a bad/expired reference shouldn't block generation
// entirely) rather than thrown.
export async function fetchReferenceImages(urls: string[]): Promise<GeminiReferenceImage[]> {
  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`No se pudo leer la imagen de referencia (HTTP ${response.status}).`);
      const extension = url.split(".").pop()?.toLowerCase() ?? "";
      const mimeType = REFERENCE_MIME_BY_EXTENSION[extension] ?? "image/png";
      const bytes = Buffer.from(await response.arrayBuffer());
      return { mimeType, data: bytes.toString("base64") };
    }),
  );
  return results
    .filter((result): result is PromiseFulfilledResult<GeminiReferenceImage> => result.status === "fulfilled")
    .map((result) => result.value);
}

// Gemini generates an abstract background texture only -- never the artist's
// likeness, never invented scenery, never baked-in text/logos. The real
// photo, name and copy are rendered on top by the Next.js template
// (spec section 10: "Gemini no debe producir HTML arbitrario ni código
// ejecutable" -- it supplies one visual layer, not the finished page).
function buildCoverPrompt(copy: ProfileCopy, professionalCategories: string[]): string {
  const energy = copy.visual_energy ?? "neutro, minimalista";
  const tone = copy.visual_tone ?? "oscuro, violeta";
  const categoryHint = professionalCategories.length > 0 ? professionalCategories.join(", ") : "identidad creativa";

  return [
    "Textura de fondo abstracta para la portada de un perfil de artista/creador en CLOUVA, una plataforma premium underground.",
    `Energía visual: ${energy}. Paleta y tono: ${tone}. Contexto profesional (solo como referencia de mood, no representar literalmente): ${categoryHint}.`,
    "Estilo: abstracto, atmosférico, granulado, con profundidad -- piensen en una textura de fondo para una portada de disco o poster de show, no una fotografía realista.",
    "PROHIBIDO ABSOLUTAMENTE: personas, rostros, siluetas humanas reconocibles, texto, letras, números, logos, marcas, watermarks, escenas concretas (ciudades específicas, edificios, objetos reconocibles) que no fueron mencionados explícitamente arriba.",
    "Formato horizontal, apto como fondo de portada con espacio para superponer texto encima.",
  ].join(" ");
}

export async function generateCoverAsset(args: {
  admin: SupabaseClient;
  entityPathPrefix: string;
  copy: ProfileCopy;
  professionalCategories: string[];
  referenceImages?: GeminiReferenceImage[];
}): Promise<GeneratedAsset> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no está configurada.");

  const estimatedCostUsd = estimateImageCostUsd(MODEL, RESOLUTION);
  const reservation = await reserveBudget(args.admin, { estimatedCostUsd });
  if (!reservation.allowed) {
    const error = new Error(`Presupuesto no disponible (${reservation.reason}).`);
    (error as Error & { code?: string }).code = "blocked_budget";
    throw error;
  }

  let generated: Awaited<ReturnType<typeof generateImage>>;
  try {
    generated = await generateImage({
      apiKey,
      prompt: buildCoverPrompt(args.copy, args.professionalCategories),
      model: MODEL,
      aspectRatio: "16:9",
      referenceImages: args.referenceImages,
    });
  } catch (generationError) {
    // Gemini never billed us if generateImage() itself threw -- safe to
    // release the full reservation as unused (same rule as the existing
    // visual-system generate route).
    await releaseBudget(args.admin, { estimatedCostUsd });
    if (generationError instanceof GeminiImageError) throw generationError;
    throw generationError instanceof Error ? generationError : new Error("Fallo desconocido generando la portada.");
  }

  const actualCostUsd = estimateFinalCostUsd({
    model: MODEL,
    resolution: RESOLUTION,
    promptTokenCount: generated.usageMetadata?.promptTokenCount,
    candidatesTokenCount: generated.usageMetadata?.candidatesTokenCount,
    thoughtsTokenCount: generated.usageMetadata?.thoughtsTokenCount,
  });
  // Google already charged for this call regardless of what happens next --
  // finalize (not release) even if the GCS upload below fails.
  await finalizeBudget(args.admin, { estimatedCostUsd, actualCostUsd });

  const url = await uploadGeneratedMedia({
    bytes: generated.bytes,
    mimeType: generated.mimeType,
    pathPrefix: `public-identity/${args.entityPathPrefix}/vip-cover`,
  });

  return { kind: "cover", url, costUsd: actualCostUsd };
}

// Same "no literal text/logos/faces" constraint as the cover -- Gemini image
// models render wordmarks unreliably, so this asks for an abstract symbol/mark
// only (spec: "logo; símbolo"), never a finished logo with the artist's name
// baked in. The owner can pair it with their real name in the template.
function buildLogoPrompt(copy: ProfileCopy, professionalCategories: string[]): string {
  const energy = copy.visual_energy ?? "neutro, minimalista";
  const tone = copy.visual_tone ?? "oscuro, violeta";
  const paletteHint = copy.palette && copy.palette.length > 0 ? copy.palette.join(", ") : tone;
  const categoryHint = professionalCategories.length > 0 ? professionalCategories.join(", ") : "identidad creativa";

  return [
    "Símbolo/marca abstracta minimalista para un perfil de artista/creador en CLOUVA, una plataforma premium underground.",
    `Energía visual: ${energy}. Colores: ${paletteHint}. Contexto profesional (solo como referencia de mood, no representar literalmente): ${categoryHint}.`,
    "Estilo: ícono geométrico simple, tipo isotipo, una o dos formas, alto contraste, fondo transparente o sólido oscuro, funciona en tamaño chico (avatar/favicon).",
    "PROHIBIDO ABSOLUTAMENTE: texto, letras, números, tipografía, nombres, personas, rostros, siluetas humanas reconocibles, fotografías, escenas concretas.",
    "Formato cuadrado, centrado, con margen alrededor del símbolo.",
  ].join(" ");
}

export async function generateLogoAsset(args: {
  admin: SupabaseClient;
  entityPathPrefix: string;
  copy: ProfileCopy;
  professionalCategories: string[];
  referenceImages?: GeminiReferenceImage[];
}): Promise<GeneratedAsset> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no está configurada.");

  const estimatedCostUsd = estimateImageCostUsd(MODEL, RESOLUTION);
  const reservation = await reserveBudget(args.admin, { estimatedCostUsd });
  if (!reservation.allowed) {
    const error = new Error(`Presupuesto no disponible (${reservation.reason}).`);
    (error as Error & { code?: string }).code = "blocked_budget";
    throw error;
  }

  let generated: Awaited<ReturnType<typeof generateImage>>;
  try {
    generated = await generateImage({
      apiKey,
      prompt: buildLogoPrompt(args.copy, args.professionalCategories),
      model: MODEL,
      aspectRatio: "1:1",
      referenceImages: args.referenceImages,
    });
  } catch (generationError) {
    await releaseBudget(args.admin, { estimatedCostUsd });
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
  await finalizeBudget(args.admin, { estimatedCostUsd, actualCostUsd });

  const url = await uploadGeneratedMedia({
    bytes: generated.bytes,
    mimeType: generated.mimeType,
    pathPrefix: `public-identity/${args.entityPathPrefix}/vip-logo`,
  });

  return { kind: "logo", url, costUsd: actualCostUsd };
}
