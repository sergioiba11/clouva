import "server-only";
import type { GeminiReferenceImage } from "@/lib/gemini-image";
import { callGeminiJson } from "@/lib/server/vip-profile-layout-gemini";
import { cropLogoRegion } from "./crop-logo-region";
import {
  DESCRIPTOR_POSITIONS,
  LETTER_SPACING_VALUES,
  LOCKUP_ORIENTATIONS,
  LOGO_COMPLEXITY,
  LOGO_OCCURRENCE_ROLES,
  LOGO_TYPES,
  NAME_POSITIONS,
  SYMBOL_POSITIONS,
  type DescriptorPosition,
  type DetectedLogo,
  type LetterSpacing,
  type LockupOrientation,
  type LogoLockupStructure,
  type LogoOccurrence,
  type LogoOccurrenceRole,
  type LogoType,
  type LogoVisibleText,
  type LogoVisualSignature,
  type NamePosition,
  type SymbolPosition,
} from "./types";

function clamp01(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0.5;
  return Math.min(1, Math.max(0, n));
}

function clampBoxCoord(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(1000, Math.max(0, Math.round(n)));
}

function sanitizeBox(raw: unknown): { top: number; left: number; bottom: number; right: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  return { top: clampBoxCoord(value.top), left: clampBoxCoord(value.left), bottom: clampBoxCoord(value.bottom), right: clampBoxCoord(value.right) };
}

function sanitizeOccurrences(raw: unknown): LogoOccurrence[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): LogoOccurrence | null => {
      if (!entry || typeof entry !== "object") return null;
      const value = entry as Record<string, unknown>;
      const box = sanitizeBox(value.box);
      const role = typeof value.role === "string" && (LOGO_OCCURRENCE_ROLES as readonly string[]).includes(value.role) ? (value.role as LogoOccurrenceRole) : null;
      if (!box || !role) return null;
      return { box, role, confidence: clamp01(value.confidence) };
    })
    .filter((entry): entry is LogoOccurrence => entry !== null)
    .slice(0, 8);
}

function sanitizeVisibleText(raw: unknown): LogoVisibleText {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const primaryName = typeof value.primaryName === "string" && value.primaryName.trim() ? value.primaryName.trim().slice(0, 80) : null;
  const descriptor = typeof value.descriptor === "string" && value.descriptor.trim() ? value.descriptor.trim().slice(0, 80) : null;
  const otherText = Array.isArray(value.otherText)
    ? value.otherText.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim().slice(0, 80)).slice(0, 5)
    : [];
  return { primaryName, descriptor, otherText };
}

function sanitizeLockupStructure(raw: unknown): LogoLockupStructure | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const symbolPosition = typeof value.symbolPosition === "string" && (SYMBOL_POSITIONS as readonly string[]).includes(value.symbolPosition)
    ? (value.symbolPosition as SymbolPosition) : "none";
  const namePosition = typeof value.namePosition === "string" && (NAME_POSITIONS as readonly string[]).includes(value.namePosition)
    ? (value.namePosition as NamePosition) : "center";
  const descriptorPosition = typeof value.descriptorPosition === "string" && (DESCRIPTOR_POSITIONS as readonly string[]).includes(value.descriptorPosition)
    ? (value.descriptorPosition as DescriptorPosition) : "none";
  const orientation = typeof value.orientation === "string" && (LOCKUP_ORIENTATIONS as readonly string[]).includes(value.orientation)
    ? (value.orientation as LockupOrientation) : "square";
  const letterSpacing = typeof value.letterSpacing === "string" && (LETTER_SPACING_VALUES as readonly string[]).includes(value.letterSpacing)
    ? (value.letterSpacing as LetterSpacing) : "normal";
  const nameToDescriptorRatio = typeof value.nameToDescriptorRatio === "number" && Number.isFinite(value.nameToDescriptorRatio) ? Math.min(6, Math.max(1, value.nameToDescriptorRatio)) : 2.5;
  const symbolToWordmarkRatio = typeof value.symbolToWordmarkRatio === "number" && Number.isFinite(value.symbolToWordmarkRatio) ? Math.min(4, Math.max(0.2, value.symbolToWordmarkRatio)) : 1;
  return { symbolPosition, namePosition, descriptorPosition, orientation, nameToDescriptorRatio, symbolToWordmarkRatio, letterSpacing };
}

function sanitizeVisualSignature(raw: unknown): LogoVisualSignature | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  return {
    silhouette: typeof value.silhouette === "string" ? value.silhouette.slice(0, 200) : "",
    geometry: typeof value.geometry === "string" ? value.geometry.slice(0, 200) : "",
    symmetry: typeof value.symmetry === "string" ? value.symmetry.slice(0, 100) : "",
    strokeWeight: typeof value.strokeWeight === "string" ? value.strokeWeight.slice(0, 100) : "",
    negativeSpace: typeof value.negativeSpace === "string" ? value.negativeSpace.slice(0, 200) : "",
    typographyStyle: typeof value.typographyStyle === "string" ? value.typographyStyle.slice(0, 200) : null,
    palette: Array.isArray(value.palette) ? value.palette.filter((c): c is string => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c)).slice(0, 6) : [],
    complexity: typeof value.complexity === "string" && (LOGO_COMPLEXITY as readonly string[]).includes(value.complexity) ? (value.complexity as (typeof LOGO_COMPLEXITY)[number]) : "medium",
  };
}

function sanitizeDetectedLogo(raw: unknown): DetectedLogo {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const detected = value.detected === true;
  if (!detected) {
    return { detected: false, confidence: 0, primaryBox: null, occurrences: [], logoType: null, visibleText: { primaryName: null, descriptor: null, otherText: [] }, lockupStructure: null, visualSignature: null };
  }
  const logoType = typeof value.logoType === "string" && (LOGO_TYPES as readonly string[]).includes(value.logoType) ? (value.logoType as LogoType) : null;
  return {
    detected: true,
    confidence: clamp01(value.confidence),
    primaryBox: sanitizeBox(value.primaryBox),
    occurrences: sanitizeOccurrences(value.occurrences),
    logoType,
    visibleText: sanitizeVisibleText(value.visibleText),
    lockupStructure: sanitizeLockupStructure(value.lockupStructure),
    visualSignature: sanitizeVisualSignature(value.visualSignature),
  };
}

const DETECTED_LOGO_JSON_SHAPE = [
  "{",
  '  "detected": boolean,',
  '  "confidence": number,',
  '  "primaryBox": { "top": number, "left": number, "bottom": number, "right": number } | null,',
  `  "occurrences": [ { "box": {"top":number,"left":number,"bottom":number,"right":number}, "role": ${LOGO_OCCURRENCE_ROLES.map((r) => `"${r}"`).join(" | ")}, "confidence": number } ],`,
  `  "logoType": ${LOGO_TYPES.map((t) => `"${t}"`).join(" | ")} | null,`,
  '  "visibleText": { "primaryName": string | null, "descriptor": string | null, "otherText": string[] },',
  '  "lockupStructure": {',
  `    "symbolPosition": ${SYMBOL_POSITIONS.map((s) => `"${s}"`).join(" | ")},`,
  `    "namePosition": ${NAME_POSITIONS.map((s) => `"${s}"`).join(" | ")},`,
  `    "descriptorPosition": ${DESCRIPTOR_POSITIONS.map((s) => `"${s}"`).join(" | ")},`,
  `    "orientation": ${LOCKUP_ORIENTATIONS.map((s) => `"${s}"`).join(" | ")},`,
  '    "nameToDescriptorRatio": number, "symbolToWordmarkRatio": number,',
  `    "letterSpacing": ${LETTER_SPACING_VALUES.map((s) => `"${s}"`).join(" | ")}`,
  "  } | null,",
  '  "visualSignature": {',
  '    "silhouette": string, "geometry": string, "symmetry": string, "strokeWeight": string,',
  '    "negativeSpace": string, "typographyStyle": string | null, "palette": string[],',
  `    "complexity": ${LOGO_COMPLEXITY.map((c) => `"${c}"`).join(" | ")}`,
  "  } | null",
  "}",
].join("\n");

// Paso 1 del análisis: mirar el mockup COMPLETO y ubicar dónde está el logo
// (primaryBox) -- sin esto no hay región que recortar todavía.
async function detectPrimaryBox(apiKey: string, referenceImage: GeminiReferenceImage): Promise<DetectedLogo> {
  const promptText = [
    "Sos un analizador visual de marcas/logos para CLOUVA.",
    "Mirá la imagen completa adjunta (mockup de web, foto de branding, dibujo/sketch) y ubicá la aparición MÁS CLARA y COMPLETA del logo/isotipo/wordmark real -- no la más chica (ej. un ícono de navbar), la que mejor muestra su composición completa (ej. un logo grande en el hero, en una pared, en un disco).",
    "No inventés nada que no esté visible. No generás HTML, CSS ni código.",
    "",
    "Devolvé exactamente este JSON, sin texto alrededor:",
    DETECTED_LOGO_JSON_SHAPE,
    "",
    'El "primaryBox" y cada "box" de "occurrences" son normalizados 0-1000 relativos a TODA la imagen (0,0 esquina superior izquierda, 1000,1000 esquina inferior derecha). Completá "occurrences" con TODAS las apariciones del logo que veas (navbar, pared, portada, disco, footer, etc), no solo la principal.',
    'Si todavía no podés leer el texto con claridad por lo chico del recorte, dejá "visibleText"/"lockupStructure"/"visualSignature" con tu mejor estimación -- se van a refinar con un recorte más grande en el siguiente paso.',
  ].join("\n");

  const { parsed } = await callGeminiJson({ apiKey, promptText, images: [referenceImage] });
  return sanitizeDetectedLogo(parsed);
}

// Paso 2: con el recorte real de la región principal (más grande, más nítido
// que el mockup completo achicado), refinar texto/estructura/lenguaje
// visual. Sin librería de OCR nueva -- Gemini multimodal lee el texto
// visible directamente del recorte con salida estructurada.
async function refineWithCrop(apiKey: string, fullImage: GeminiReferenceImage, cropImage: GeminiReferenceImage, initial: DetectedLogo): Promise<DetectedLogo> {
  const promptText = [
    "Sos un analizador visual de marcas/logos para CLOUVA.",
    "Se te adjuntan DOS imágenes: la imagen 0 es el mockup/referencia completo, la imagen 1 es un RECORTE ampliado de la región principal del logo (misma imagen, más grande y nítido) -- usá el recorte para leer el texto y la estructura con precisión, y la imagen completa para confirmar contexto/paleta general.",
    `Análisis previo (a refinar, no a ignorar): ${JSON.stringify({ logoType: initial.logoType, visibleText: initial.visibleText, lockupStructure: initial.lockupStructure })}`,
    "",
    "Prestá especial atención a: el texto EXACTO visible (mayúsculas/tildes tal cual aparecen, ej. si dice \"IGLÚ\" no lo cambies a \"Iglu\" ni a \"El Iglú\"), si hay un nombre principal y un descriptor secundario debajo/al lado, el tracking (espaciado entre letras) de cada uno, y la posición relativa del símbolo respecto al texto.",
    "",
    "Devolvé exactamente este JSON, sin texto alrededor (mismo esquema que antes, ahora refinado):",
    DETECTED_LOGO_JSON_SHAPE,
  ].join("\n");

  const { parsed } = await callGeminiJson({ apiKey, promptText, images: [fullImage, cropImage] });
  const refined = sanitizeDetectedLogo(parsed);
  // Defensivo: si el paso de refinamiento no detecta nada (falla parcial),
  // preferimos el análisis inicial antes que perder toda la información.
  return refined.detected ? refined : initial;
}

// Punto de entrada del motor: detecta y describe (nunca copia) el logo real
// de una imagen de referencia -- dos pasadas (mockup completo -> recorte de
// la región principal) para leer texto/estructura con precisión sin
// necesitar una librería de OCR nueva.
export async function detectLogoInReference(args: {
  apiKey: string;
  referenceImage: GeminiReferenceImage;
}): Promise<DetectedLogo> {
  const initial = await detectPrimaryBox(args.apiKey, args.referenceImage);
  if (!initial.detected || !initial.primaryBox) return initial;

  try {
    const referenceBytes = Buffer.from(args.referenceImage.data, "base64");
    const cropBytes = await cropLogoRegion({ referenceBytes, normalizedBox: initial.primaryBox });
    const cropImage: GeminiReferenceImage = { mimeType: "image/png", data: cropBytes.toString("base64") };
    return await refineWithCrop(args.apiKey, args.referenceImage, cropImage, initial);
  } catch {
    // El recorte/refinamiento es best-effort -- si falla (imagen rara,
    // Gemini no responde), nos quedamos con la primera pasada en vez de
    // tumbar todo el análisis.
    return initial;
  }
}
