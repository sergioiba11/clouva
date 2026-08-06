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
  type NormalizedBox,
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

function sanitizeBox(raw: unknown): NormalizedBox | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const box = { top: clampBoxCoord(value.top), left: clampBoxCoord(value.left), bottom: clampBoxCoord(value.bottom), right: clampBoxCoord(value.right) };
  return box.right > box.left && box.bottom > box.top ? box : null;
}

function boxArea(box: NormalizedBox): number {
  return Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);
}

// Un logo dentro de un mockup no puede ser una franja que contenga media web.
// El fallo real de El Iglú fue un box de ~18.5% de toda la captura que incluía
// hero, texto y botones. Ese recorte no representa un logo y no debe llegar a
// la generación visual.
export function isLogoBoxUsable(box: NormalizedBox | null | undefined): box is NormalizedBox {
  if (!box) return false;
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  if (width < 18 || height < 18) return false;
  if (width > 900 || height > 900) return false;
  if (boxArea(box) > 160_000) return false; // máximo 16% de la imagen completa
  const aspect = width / height;
  return aspect >= 0.18 && aspect <= 8;
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

export function hasUsableSymbolReference(detected: DetectedLogo | null | undefined): boolean {
  if (!detected?.detected || !isLogoBoxUsable(detected.primaryBox) || !detected.visualSignature) return false;
  const standaloneSymbol = detected.logoType === "symbol" || detected.logoType === "monogram" || detected.logoType === "emblem";
  const symbolInLockup = detected.lockupStructure?.symbolPosition && detected.lockupStructure.symbolPosition !== "none";
  return Boolean(standaloneSymbol || symbolInLockup);
}

function chooseUsableBox(initial: DetectedLogo): NormalizedBox | null {
  const rolePriority: Record<LogoOccurrenceRole, number> = { symbol: 0, primary_lockup: 1, wordmark: 2, secondary_application: 3 };
  const candidates: Array<{ box: NormalizedBox; role: LogoOccurrenceRole; confidence: number }> = [];
  if (initial.primaryBox) candidates.push({ box: initial.primaryBox, role: "primary_lockup", confidence: initial.confidence });
  for (const occurrence of initial.occurrences) candidates.push(occurrence);
  return candidates
    .filter((candidate) => isLogoBoxUsable(candidate.box))
    .sort((a, b) => rolePriority[a.role] - rolePriority[b.role] || b.confidence - a.confidence || boxArea(a.box) - boxArea(b.box))[0]?.box ?? null;
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

async function detectPrimaryBox(apiKey: string, referenceImage: GeminiReferenceImage): Promise<DetectedLogo> {
  const promptText = [
    "Sos un analizador visual de marcas/logos para CLOUVA.",
    "Mirá la imagen completa adjunta y ubicá SOLO marcas gráficas reales: isotipos, símbolos, monogramas, emblemas o lockups compactos de símbolo + nombre.",
    "NO confundas el título gigante del hero, un eslogan, párrafos, botones, navegación ni una sección completa con el logo. Un box válido debe encerrar únicamente la marca y un margen pequeño; nunca media pantalla ni contenido de la web.",
    "Preferí una aplicación clara en pared, monitor, portada, disco o navbar. Si hay símbolo y wordmark, registralos por separado en occurrences y elegí como primaryBox la aplicación compacta más nítida que incluya el símbolo real.",
    "El primaryBox ideal ocupa menos del 12% de la imagen completa. Si la única caja que encontrás supera aproximadamente 16%, devolvé primaryBox null y mantené las occurrences pequeñas válidas.",
    "No inventés nada que no esté visible. No generás HTML, CSS ni código.",
    "",
    "Devolvé exactamente este JSON, sin texto alrededor:",
    DETECTED_LOGO_JSON_SHAPE,
    "",
    'Los boxes son normalizados 0-1000 relativos a TODA la imagen. Completá occurrences con TODAS las apariciones compactas del logo que veas.',
  ].join("\n");

  const { parsed } = await callGeminiJson({ apiKey, promptText, images: [referenceImage] });
  return sanitizeDetectedLogo(parsed);
}

async function refineWithCrop(apiKey: string, fullImage: GeminiReferenceImage, cropImage: GeminiReferenceImage, initial: DetectedLogo, manual: boolean): Promise<DetectedLogo> {
  const promptText = [
    "Sos un analizador visual de marcas/logos para CLOUVA.",
    `Se te adjuntan DOS imágenes: imagen 0 = referencia completa; imagen 1 = ${manual ? "RECORTE ELEGIDO MANUALMENTE POR EL USUARIO" : "recorte automático"} que debe analizarse como la fuente principal de la marca.`,
    "Analizá únicamente la marca contenida en el recorte. Ignorá cualquier texto de interfaz, hero, botones o arquitectura que haya quedado fuera de la marca.",
    `Análisis previo: ${JSON.stringify({ logoType: initial.logoType, visibleText: initial.visibleText, lockupStructure: initial.lockupStructure })}`,
    "Leé el texto exacto, identificá el símbolo real y su posición. Si el recorte contiene solo wordmark y ningún símbolo, declaralo con symbolPosition none; no inventes uno.",
    "Devolvé exactamente este JSON, sin texto alrededor:",
    DETECTED_LOGO_JSON_SHAPE,
  ].join("\n");

  const { parsed } = await callGeminiJson({ apiKey, promptText, images: [fullImage, cropImage] });
  const refined = sanitizeDetectedLogo(parsed);
  return refined.detected ? refined : initial;
}

export async function detectLogoInReference(args: {
  apiKey: string;
  referenceImage: GeminiReferenceImage;
  manualBox?: NormalizedBox | null;
}): Promise<DetectedLogo> {
  const manualBox = isLogoBoxUsable(args.manualBox) ? args.manualBox : null;
  const detectedInitial = manualBox
    ? {
        detected: true,
        confidence: 1,
        primaryBox: manualBox,
        occurrences: [{ box: manualBox, role: "primary_lockup" as const, confidence: 1 }],
        logoType: null,
        visibleText: { primaryName: null, descriptor: null, otherText: [] },
        lockupStructure: null,
        visualSignature: null,
      }
    : await detectPrimaryBox(args.apiKey, args.referenceImage);

  if (!detectedInitial.detected) return detectedInitial;
  const chosenBox = manualBox ?? chooseUsableBox(detectedInitial);
  if (!chosenBox) {
    return { ...detectedInitial, confidence: Math.min(detectedInitial.confidence, 0.49), primaryBox: null };
  }

  const initial: DetectedLogo = {
    ...detectedInitial,
    primaryBox: chosenBox,
    occurrences: detectedInitial.occurrences.length > 0
      ? detectedInitial.occurrences
      : [{ box: chosenBox, role: "primary_lockup", confidence: detectedInitial.confidence }],
  };

  try {
    const referenceBytes = Buffer.from(args.referenceImage.data, "base64");
    const cropBytes = await cropLogoRegion({ referenceBytes, normalizedBox: chosenBox, paddingPct: manualBox ? 0.04 : 0.1 });
    const cropImage: GeminiReferenceImage = { mimeType: "image/png", data: cropBytes.toString("base64") };
    const refined = await refineWithCrop(args.apiKey, args.referenceImage, cropImage, initial, Boolean(manualBox));
    return {
      ...refined,
      primaryBox: chosenBox,
      occurrences: initial.occurrences,
      confidence: manualBox ? Math.max(refined.confidence, 0.95) : refined.confidence,
    };
  } catch {
    return initial;
  }
}
