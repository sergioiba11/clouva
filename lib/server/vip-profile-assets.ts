import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GeminiImageError, generateImage, type GeminiReferenceImage } from "@/lib/gemini-image";
import { uploadGeneratedMedia } from "@/lib/gcs-media";
import { finalizeBudget, releaseBudget, reserveBudget } from "@/lib/ai-budget/budget-service";
import { estimateFinalCostUsd, estimateImageCostUsd } from "@/lib/ai-budget/gemini-pricing";
import type { ProfileCopy } from "@/lib/server/vip-profile-gemini";

const MODEL = "gemini-3.1-flash-image";
const RESOLUTION = "1K" as const;

export type GeneratedAsset = { kind: "cover" | "logo" | "pillar"; url: string; costUsd: number };

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
// Cover portadas were originally abstract-only (no scenes/objects) to stay
// safely inside what Gemini renders reliably. The user explicitly asked for
// a themed, scene-like hero (e.g. a recording studio interior matching an
// uploaded reference image's aesthetic) instead -- still no people/faces
// (recognizable-human-likeness risk) and no text/logos (Gemini renders text
// unreliably), but environments/objects are now allowed and encouraged.
function buildCoverPrompt(copy: ProfileCopy, professionalCategories: string[], hasReferenceImage: boolean, literalReference: boolean): string {
  const energy = copy.visual_energy ?? "neutro, minimalista";
  const tone = copy.visual_tone ?? "oscuro, violeta";
  const categoryHint = professionalCategories.length > 0 ? professionalCategories.join(", ") : "identidad creativa";

  return [
    "Portada/hero para el perfil de un artista, creador o estudio en CLOUVA, una plataforma premium underground.",
    `Energía visual: ${energy}. Paleta y tono: ${tone}. Contexto profesional: ${categoryHint}.`,
    hasReferenceImage
      ? (literalReference
        // reference_layout: el usuario subió un mockup de web real y espera
        // que la portada final se vea IGUAL a la escena de esa referencia
        // (mismo ambiente, materiales, iluminación, encuadre) -- ya no
        // "inspirado en el estilo", sino una recreación lo más fiel posible
        // de esa escena específica.
        ? "Usá la imagen de referencia adjunta como la escena EXACTA a recrear: mismo ambiente, mismos materiales/texturas, misma iluminación, mismo encuadre y composición general -- el objetivo es que se vea como una foto de ese mismo lugar, no una variación libre ni una interpretación distinta."
        : "Usá la imagen de referencia adjunta como guía de estética, materiales, iluminación y composición para generar un ambiente/escena temática coherente con esa referencia (por ejemplo un espacio de trabajo, estudio, escenario o entorno que represente la identidad) -- no una réplica literal de la imagen, sino algo inspirado en su estilo.")
      : "Generá un ambiente o escena temática que represente la identidad (por ejemplo un espacio de trabajo, estudio, escenario o entorno atmosférico), coherente con la energía y la paleta indicadas.",
    "Estilo: fotográfico o ilustrado con atmósfera cinematográfica, buena composición y profundidad -- apto como fondo de portada con espacio para superponer texto encima.",
    "PROHIBIDO ABSOLUTAMENTE: personas, rostros o siluetas humanas reconocibles, texto, letras, números, logos, marcas, watermarks.",
    "Formato horizontal.",
  ].join(" ");
}

export async function generateCoverAsset(args: {
  admin: SupabaseClient;
  entityPathPrefix: string;
  copy: ProfileCopy;
  professionalCategories: string[];
  referenceImages?: GeminiReferenceImage[];
  literalReference?: boolean;
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
      prompt: buildCoverPrompt(args.copy, args.professionalCategories, Boolean(args.referenceImages?.length), Boolean(args.literalReference)),
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

// Foto de ambiente para una tarjeta "pillar" del layout (ej. "Grabación",
// "Producción") -- a diferencia del logo, acá SÍ se permiten personas/rostros
// (son fotos de escena real, no un ícono de marca), pero se mantiene la misma
// prohibición de texto/tipografía que cover y logo (Gemini lo renderiza mal).
// Solo se usa en el flujo reference_layout (un único resultado, no las 3
// variantes de adaptive_layout) -- ver process-job/route.ts.
function buildPillarPrompt(title: string, description: string, professionalCategories: string[]): string {
  const categoryHint = professionalCategories.length > 0 ? professionalCategories.join(", ") : "identidad creativa";

  return [
    `Foto de ambiente/escena real para la tarjeta "${title}" de la web de un estudio/artista en CLOUVA, una plataforma premium underground.`,
    `Lo que representa esta tarjeta: ${description}. Contexto profesional: ${categoryHint}.`,
    "Estilo: fotográfico, atmósfera cinematográfica, buena composición y profundidad, apto como fondo de tarjeta con texto superpuesto encima (dejar zonas con menos detalle donde pueda ir texto).",
    "PROHIBIDO ABSOLUTAMENTE: texto, letras, números, tipografía, logos, marcas, watermarks.",
    "Formato horizontal.",
  ].join(" ");
}

export async function generatePillarAsset(args: {
  admin: SupabaseClient;
  entityPathPrefix: string;
  title: string;
  description: string;
  professionalCategories: string[];
  index: number;
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
      prompt: buildPillarPrompt(args.title, args.description, args.professionalCategories),
      model: MODEL,
      aspectRatio: "16:9",
    });
  } catch (generationError) {
    await releaseBudget(args.admin, { estimatedCostUsd });
    if (generationError instanceof GeminiImageError) throw generationError;
    throw generationError instanceof Error ? generationError : new Error("Fallo desconocido generando la foto del pilar.");
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
    pathPrefix: `public-identity/${args.entityPathPrefix}/vip-pillar-${args.index}`,
  });

  return { kind: "pillar", url, costUsd: actualCostUsd };
}
