import "server-only";
import type { GeminiReferenceImage } from "@/lib/gemini-image";
import { callGeminiJson } from "@/lib/server/vip-profile-layout-gemini";
import { cropLogoRegion } from "./crop-logo-region";
import {
  DESCRIPTOR_POSITIONS,
  LETTER_SPACING_VALUES,
  LOCKUP_ORIENTATIONS,
  LOGO_COMPLEXITY,
  LOGO_COMPONENT_KINDS,
  LOGO_OCCURRENCE_ROLES,
  LOGO_TYPES,
  NAME_POSITIONS,
  SYMBOL_POSITIONS,
  type DescriptorPosition,
  type DetectedLogo,
  type LetterSpacing,
  type LockupOrientation,
  type LogoComponentAnalysis,
  type LogoComponentKind,
  type LogoDecomposition,
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

const clamp01 = (value: unknown) => Math.min(1, Math.max(0, typeof value === "number" && Number.isFinite(value) ? value : 0.5));
const clampBoxCoord = (value: unknown) => Math.min(1000, Math.max(0, Math.round(typeof value === "number" && Number.isFinite(value) ? value : 0)));

function sanitizeBox(raw: unknown): NormalizedBox | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const box = { top: clampBoxCoord(value.top), left: clampBoxCoord(value.left), bottom: clampBoxCoord(value.bottom), right: clampBoxCoord(value.right) };
  return box.right > box.left && box.bottom > box.top ? box : null;
}

function boxArea(box: NormalizedBox) {
  return Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top);
}

// Evita que una franja del hero o media página se trate como logo.
export function isLogoBoxUsable(box: NormalizedBox | null | undefined): box is NormalizedBox {
  if (!box) return false;
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  if (width < 18 || height < 18 || width > 900 || height > 900) return false;
  if (boxArea(box) > 160_000) return false;
  const aspect = width / height;
  return aspect >= 0.18 && aspect <= 8;
}

function sanitizeOccurrences(raw: unknown): LogoOccurrence[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry): LogoOccurrence | null => {
    if (!entry || typeof entry !== "object") return null;
    const value = entry as Record<string, unknown>;
    const box = sanitizeBox(value.box);
    const role = typeof value.role === "string" && (LOGO_OCCURRENCE_ROLES as readonly string[]).includes(value.role) ? value.role as LogoOccurrenceRole : null;
    return box && role ? { box, role, confidence: clamp01(value.confidence) } : null;
  }).filter((entry): entry is LogoOccurrence => entry !== null).slice(0, 8);
}

function sanitizeVisibleText(raw: unknown): LogoVisibleText {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    primaryName: typeof value.primaryName === "string" && value.primaryName.trim() ? value.primaryName.trim().slice(0, 80) : null,
    descriptor: typeof value.descriptor === "string" && value.descriptor.trim() ? value.descriptor.trim().slice(0, 80) : null,
    otherText: Array.isArray(value.otherText) ? value.otherText.filter((text): text is string => typeof text === "string" && Boolean(text.trim())).map((text) => text.trim().slice(0, 80)).slice(0, 5) : [],
  };
}

function sanitizeLockupStructure(raw: unknown): LogoLockupStructure | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const symbolPosition = typeof value.symbolPosition === "string" && (SYMBOL_POSITIONS as readonly string[]).includes(value.symbolPosition) ? value.symbolPosition as SymbolPosition : "none";
  const namePosition = typeof value.namePosition === "string" && (NAME_POSITIONS as readonly string[]).includes(value.namePosition) ? value.namePosition as NamePosition : "center";
  const descriptorPosition = typeof value.descriptorPosition === "string" && (DESCRIPTOR_POSITIONS as readonly string[]).includes(value.descriptorPosition) ? value.descriptorPosition as DescriptorPosition : "none";
  const orientation = typeof value.orientation === "string" && (LOCKUP_ORIENTATIONS as readonly string[]).includes(value.orientation) ? value.orientation as LockupOrientation : "square";
  const letterSpacing = typeof value.letterSpacing === "string" && (LETTER_SPACING_VALUES as readonly string[]).includes(value.letterSpacing) ? value.letterSpacing as LetterSpacing : "normal";
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
    palette: Array.isArray(value.palette) ? value.palette.filter((color): color is string => typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)).slice(0, 6) : [],
    complexity: typeof value.complexity === "string" && (LOGO_COMPLEXITY as readonly string[]).includes(value.complexity) ? value.complexity as (typeof LOGO_COMPLEXITY)[number] : "medium",
  };
}

function sanitizeComponents(raw: unknown): LogoComponentAnalysis[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<LogoComponentKind>();
  return raw.map((entry): LogoComponentAnalysis | null => {
    if (!entry || typeof entry !== "object") return null;
    const value = entry as Record<string, unknown>;
    const kind = typeof value.kind === "string" && (LOGO_COMPONENT_KINDS as readonly string[]).includes(value.kind) ? value.kind as LogoComponentKind : null;
    if (!kind || seen.has(kind)) return null;
    seen.add(kind);
    const present = value.present === true;
    return {
      kind,
      present,
      confidence: clamp01(value.confidence),
      box: present ? sanitizeBox(value.box) : null,
      description: typeof value.description === "string" ? value.description.slice(0, 240) : "",
      expectedText: typeof value.expectedText === "string" && value.expectedText.trim() ? value.expectedText.trim().slice(0, 80) : null,
    };
  }).filter((entry): entry is LogoComponentAnalysis => entry !== null);
}

function sanitizeDecomposition(raw: unknown): LogoDecomposition | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const foregroundPolarity = value.foregroundPolarity === "light_on_dark" || value.foregroundPolarity === "dark_on_light" || value.foregroundPolarity === "mixed" ? value.foregroundPolarity : "mixed";
  const recommendedColorCount = Math.min(4, Math.max(1, Math.round(typeof value.recommendedColorCount === "number" ? value.recommendedColorCount : 2)));
  return {
    components: sanitizeComponents(value.components),
    foregroundPolarity,
    recommendedColorCount,
    backgroundDescription: typeof value.backgroundDescription === "string" ? value.backgroundDescription.slice(0, 200) : "",
  };
}

export function sanitizeDetectedLogo(raw: unknown): DetectedLogo {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (value.detected !== true) {
    return { detected: false, confidence: 0, primaryBox: null, occurrences: [], logoType: null, visibleText: { primaryName: null, descriptor: null, otherText: [] }, lockupStructure: null, visualSignature: null, decomposition: null };
  }
  const logoType = typeof value.logoType === "string" && (LOGO_TYPES as readonly string[]).includes(value.logoType) ? value.logoType as LogoType : null;
  return {
    detected: true,
    confidence: clamp01(value.confidence),
    primaryBox: sanitizeBox(value.primaryBox),
    occurrences: sanitizeOccurrences(value.occurrences),
    logoType,
    visibleText: sanitizeVisibleText(value.visibleText),
    lockupStructure: sanitizeLockupStructure(value.lockupStructure),
    visualSignature: sanitizeVisualSignature(value.visualSignature),
    decomposition: sanitizeDecomposition(value.decomposition),
  };
}

export function hasUsableSymbolReference(detected: DetectedLogo | null | undefined) {
  if (!detected?.detected || !isLogoBoxUsable(detected.primaryBox) || !detected.visualSignature) return false;
  const symbol = detected.decomposition?.components.find((component) => component.kind === "symbol" && component.present && component.box);
  const standalone = detected.logoType === "symbol" || detected.logoType === "monogram" || detected.logoType === "emblem";
  return Boolean(symbol || standalone || (detected.lockupStructure?.symbolPosition && detected.lockupStructure.symbolPosition !== "none"));
}

function chooseUsableBox(initial: DetectedLogo): NormalizedBox | null {
  const rolePriority: Record<LogoOccurrenceRole, number> = { primary_lockup: 0, symbol: 1, wordmark: 2, secondary_application: 3 };
  const candidates: Array<{ box: NormalizedBox; role: LogoOccurrenceRole; confidence: number }> = [];
  if (initial.primaryBox) candidates.push({ box: initial.primaryBox, role: "primary_lockup", confidence: initial.confidence });
  for (const occurrence of initial.occurrences) candidates.push(occurrence);
  return candidates.filter((candidate) => isLogoBoxUsable(candidate.box)).sort((a, b) => rolePriority[a.role] - rolePriority[b.role] || b.confidence - a.confidence || boxArea(a.box) - boxArea(b.box))[0]?.box ?? null;
}

const JSON_SHAPE = [
  "{",
  '  "detected": boolean, "confidence": number,',
  '  "primaryBox": {"top":number,"left":number,"bottom":number,"right":number} | null,',
  `  "occurrences": [{"box":{"top":number,"left":number,"bottom":number,"right":number},"role":${LOGO_OCCURRENCE_ROLES.map((value) => `"${value}"`).join("|")},"confidence":number}],`,
  `  "logoType": ${LOGO_TYPES.map((value) => `"${value}"`).join("|")} | null,`,
  '  "visibleText": {"primaryName":string|null,"descriptor":string|null,"otherText":string[]},',
  `  "lockupStructure": {"symbolPosition":${SYMBOL_POSITIONS.map((value) => `"${value}"`).join("|")},"namePosition":${NAME_POSITIONS.map((value) => `"${value}"`).join("|")},"descriptorPosition":${DESCRIPTOR_POSITIONS.map((value) => `"${value}"`).join("|")},"orientation":${LOCKUP_ORIENTATIONS.map((value) => `"${value}"`).join("|")},"nameToDescriptorRatio":number,"symbolToWordmarkRatio":number,"letterSpacing":${LETTER_SPACING_VALUES.map((value) => `"${value}"`).join("|")}} | null,`,
  `  "visualSignature": {"silhouette":string,"geometry":string,"symmetry":string,"strokeWeight":string,"negativeSpace":string,"typographyStyle":string|null,"palette":string[],"complexity":${LOGO_COMPLEXITY.map((value) => `"${value}"`).join("|")}} | null,`,
  '  "decomposition": {',
  `    "components": [{"kind":${LOGO_COMPONENT_KINDS.map((value) => `"${value}"`).join("|")},"present":boolean,"confidence":number,"box":{"top":number,"left":number,"bottom":number,"right":number}|null,"description":string,"expectedText":string|null}],`,
  '    "foregroundPolarity":"light_on_dark"|"dark_on_light"|"mixed",',
  '    "recommendedColorCount":number, "backgroundDescription":string',
  "  } | null",
  "}",
].join("\n");

async function detectPrimaryBox(apiKey: string, referenceImage: GeminiReferenceImage) {
  const promptText = [
    "Sos el analizador de identidad visual de CLOUVA.",
    "Ubicá únicamente aplicaciones compactas del logo real. No confundas hero, título grande, botones, navegación, carteles decorativos ni una sección completa con el logo.",
    "El primaryBox debe encerrar el lockup más nítido y completo con un margen mínimo. Preferí pared, monitor, portada, disco o navbar.",
    "Los boxes de esta primera respuesta son 0-1000 relativos a la imagen completa.",
    "No inventes símbolos ni texto.",
    "Devolvé exclusivamente:",
    JSON_SHAPE,
    "En esta primera pasada decomposition puede ser null; se completará analizando el recorte.",
  ].join("\n");
  const { parsed } = await callGeminiJson({ apiKey, promptText, images: [referenceImage] });
  return sanitizeDetectedLogo(parsed);
}

async function refineWithCrop(args: {
  apiKey: string;
  fullImage: GeminiReferenceImage;
  cropImage: GeminiReferenceImage;
  initial: DetectedLogo;
  manual: boolean;
}) {
  const promptText = [
    "Sos el analizador de identidad visual de CLOUVA.",
    `Imagen 0: mockup completo. Imagen 1: ${args.manual ? "recorte elegido por el usuario" : "recorte automático"}.`,
    "La imagen 1 es la única fuente para desarmar el logo. Leé exactamente el texto y separá símbolo, wordmark y descriptor.",
    "IMPORTANTE: los boxes dentro de decomposition son 0-1000 RELATIVOS A LA IMAGEN 1, no al mockup completo.",
    "Cada box debe quedar ajustado al componente y no incluir otro componente. Si no existe un componente, present=false y box=null.",
    "full_lockup debe abarcar todo el contenido útil del recorte. No incluyas textura de pared, hielo, monitor ni fondo.",
    "foregroundPolarity describe si el logo es claro sobre fondo oscuro, oscuro sobre claro o mixto. recommendedColorCount debe estar entre 1 y 4.",
    "No inventes un símbolo ausente. No cambies el nombre. No diseñes nada.",
    `Análisis previo: ${JSON.stringify({ logoType: args.initial.logoType, visibleText: args.initial.visibleText, lockupStructure: args.initial.lockupStructure })}`,
    "Devolvé exclusivamente:",
    JSON_SHAPE,
  ].join("\n");
  const { parsed } = await callGeminiJson({ apiKey: args.apiKey, promptText, images: [args.fullImage, args.cropImage] });
  return sanitizeDetectedLogo(parsed);
}

export async function detectLogoInReference(args: {
  apiKey: string;
  referenceImage: GeminiReferenceImage;
  manualBox?: NormalizedBox | null;
}): Promise<DetectedLogo> {
  const manualBox = isLogoBoxUsable(args.manualBox) ? args.manualBox : null;
  const initial = manualBox ? {
    detected: true,
    confidence: 1,
    primaryBox: manualBox,
    occurrences: [{ box: manualBox, role: "primary_lockup" as const, confidence: 1 }],
    logoType: null,
    visibleText: { primaryName: null, descriptor: null, otherText: [] },
    lockupStructure: null,
    visualSignature: null,
    decomposition: null,
  } satisfies DetectedLogo : await detectPrimaryBox(args.apiKey, args.referenceImage);
  if (!initial.detected) return initial;
  const chosenBox = manualBox ?? chooseUsableBox(initial);
  if (!chosenBox) return { ...initial, confidence: Math.min(initial.confidence, 0.49), primaryBox: null, decomposition: null };

  const cropBytes = await cropLogoRegion({
    referenceBytes: Buffer.from(args.referenceImage.data, "base64"),
    normalizedBox: chosenBox,
    paddingPct: 0.04,
  });
  const cropImage: GeminiReferenceImage = { mimeType: "image/png", data: cropBytes.toString("base64") };
  const refined = await refineWithCrop({ apiKey: args.apiKey, fullImage: args.referenceImage, cropImage, initial, manual: Boolean(manualBox) });
  return {
    ...refined,
    detected: true,
    confidence: Math.max(refined.confidence, initial.confidence),
    primaryBox: chosenBox,
    occurrences: initial.occurrences.length ? initial.occurrences : [{ box: chosenBox, role: "primary_lockup", confidence: initial.confidence }],
  };
}
