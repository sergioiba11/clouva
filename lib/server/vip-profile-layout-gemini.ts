import "server-only";
import type { GeminiReferenceImage } from "@/lib/gemini-image";
import {
  BLUR_PRESETS,
  BUTTON_STYLES,
  CARD_STYLES,
  DECORATION_TYPES,
  FONT_WEIGHTS,
  IMAGE_FITS,
  IMAGE_POSITIONS,
  IMAGE_SLOTS,
  LAYOUT_ICONS,
  LAYOUT_SECTION_TYPES,
  POSITIONED_ELEMENT_TYPES,
  SHADOW_PRESETS,
  TEXT_ALIGNS,
  sanitizeLayoutConfig,
  type LayoutConfig,
} from "./layout-config";
import { getGeminiLayoutModelPolicy, type GeminiLayoutWorkload } from "./gemini-layout-model-policy";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export class LayoutGeminiError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

// Shared JSON+multimodal client. Existing callers remain source compatible;
// Reference Fidelity V2 only adds an optional workload so model choice is no
// longer hardcoded to Flash-Lite for every visual task.
export async function callGeminiJson(args: {
  apiKey: string;
  promptText: string;
  images: GeminiReferenceImage[];
  workload?: GeminiLayoutWorkload;
}) {
  const workload = args.workload ?? "adaptive_layout";
  const policy = getGeminiLayoutModelPolicy(workload);
  const parts: Array<Record<string, unknown>> = [{ text: args.promptText }];
  for (const image of args.images) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });

  const response = await fetch(`${ENDPOINT}/${policy.model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": args.apiKey },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: policy.temperature,
        maxOutputTokens: workload === "reference_precise" ? 32_768 : 8_192,
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(policy.timeoutMs),
  });

  const raw = await response.text();
  let data: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    error?: { message?: string };
  } = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new LayoutGeminiError("Gemini devolvió una respuesta inválida.");
  }
  if (!response.ok) throw new LayoutGeminiError(data.error?.message ?? `Gemini respondió HTTP ${response.status}`, response.status);

  const text = data.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;
  if (!text) throw new LayoutGeminiError("Gemini no devolvió texto.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LayoutGeminiError("No se pudo interpretar la respuesta de Gemini como JSON.");
  }

  const promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
  const costUsd = Number((
    (promptTokens / 1_000_000) * policy.inputPricePerMillion +
    (outputTokens / 1_000_000) * policy.outputPricePerMillion
  ).toFixed(6));

  return { parsed, costUsd, model: policy.model };
}

export const IMAGE_CATEGORIES = ["web_mockup", "ui_reference", "brand_reference", "studio_photo", "artist_photo", "moodboard", "flyer", "other"] as const;
export type ImageCategory = (typeof IMAGE_CATEGORIES)[number];

export type ImageClassification = { index: number; category: ImageCategory; is_layout_relevant: boolean; notes: string | null };

export type ReferenceAnalysis = {
  mode: "reference_layout" | "adaptive_layout";
  confidence: number;
  summary: string | null;
  images: ImageClassification[];
};

function sanitizeAnalysis(raw: unknown, imageCount: number): ReferenceAnalysis {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const mode = value.mode === "reference_layout" ? "reference_layout" : "adaptive_layout";
  const confidence = typeof value.confidence === "number" && value.confidence >= 0 && value.confidence <= 1 ? value.confidence : 0.5;
  const summary = typeof value.summary === "string" ? value.summary.trim().slice(0, 500) : null;
  const rawImages = Array.isArray(value.images) ? value.images : [];
  const images: ImageClassification[] = [];
  for (let index = 0; index < imageCount; index += 1) {
    const entry = rawImages.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).index === index) as Record<string, unknown> | undefined;
    const category = entry && IMAGE_CATEGORIES.includes(entry.category as ImageCategory) ? (entry.category as ImageCategory) : "other";
    images.push({
      index,
      category,
      is_layout_relevant: category === "web_mockup" || category === "ui_reference",
      notes: entry && typeof entry.notes === "string" ? entry.notes.trim().slice(0, 200) : null,
    });
  }
  return { mode, confidence, summary, images };
}

export async function analyzeReferenceImages(args: {
  apiKey: string;
  images: GeminiReferenceImage[];
  facts: Record<string, unknown>;
  subjectLabel: "Player" | "Estudio";
}): Promise<{ analysis: ReferenceAnalysis; costUsd: number }> {
  if (args.images.length === 0) {
    return { analysis: { mode: "adaptive_layout", confidence: 1, summary: "Sin imágenes de referencia.", images: [] }, costUsd: 0 };
  }

  const promptText = [
    "Sos un analizador visual para CLOUVA, una plataforma para artistas, estudios y creadores.",
    "Analizá las imágenes y devolvé ÚNICAMENTE JSON válido. No generes HTML/CSS/código ni inventes datos.",
    `Datos confirmados del ${args.subjectLabel}: ${JSON.stringify(args.facts)}`,
    `Se adjuntan ${args.images.length} imagen(es), índice 0 en adelante.`,
    "Clasificación permitida: web_mockup, ui_reference, brand_reference, studio_photo, artist_photo, moodboard, flyer, other.",
    "Si una imagen muestra estructura real de web/UI (nav, hero, secciones, cards, footer, composición editorial reconocible), elegí reference_layout. Si son solo fotos/branding/moodboards/flyers, elegí adaptive_layout.",
    "Devolvé exactamente:",
    '{ "mode": "reference_layout" | "adaptive_layout", "confidence": number, "summary": string, "images": [{ "index": number, "category": string, "notes": string }] }',
  ].join("\n");

  const { parsed, costUsd } = await callGeminiJson({
    apiKey: args.apiKey,
    promptText,
    images: args.images,
    workload: "classification",
  });
  return { analysis: sanitizeAnalysis(parsed, args.images.length), costUsd };
}

// Template-mode generator retained for backward compatibility and adaptive
// layouts. reference_layout should normally use generatePreciseLayoutConfig.
export async function generateLayoutConfig(args: {
  apiKey: string;
  images: GeminiReferenceImage[];
  analysis: ReferenceAnalysis;
  facts: Record<string, unknown>;
  copy: { tagline: string | null; short_bio: string | null };
  subjectLabel: "Player" | "Estudio";
}): Promise<{ layout: LayoutConfig | null; costUsd: number }> {
  const relevantIndexes = args.analysis.images.filter((image) => image.is_layout_relevant).map((image) => image.index);
  const promptText = [
    "Sos un generador de layout estructurado para CLOUVA. Nunca generás HTML/CSS/JSX, solo layout_config.",
    `Modo: "${args.analysis.mode}".`,
    args.analysis.mode === "reference_layout"
      ? `Las imágenes ${JSON.stringify(relevantIndexes)} son referencias web. Reproducí su jerarquía usando solo el vocabulario permitido.`
      : "No hay una web de referencia clara. Construí una composición original coherente con fotos/branding/datos reales.",
    `Resumen: ${args.analysis.summary ?? "(sin resumen)"}`,
    `Datos confirmados del ${args.subjectLabel}: ${JSON.stringify(args.facts)}`,
    `Copy aprobado: tagline=${JSON.stringify(args.copy.tagline)}, bio=${JSON.stringify(args.copy.short_bio)}`,
    "Secciones: hero, about, pillars, gallery, roster, services, membership, music, contact.",
    "Variantes: hero centered|split|editorial|full-bleed|overlay; about simple|editorial|image-left|image-right; pillars 3-cards|4-cards|icon-grid; gallery grid|masonry|strip|collage-clean; roster cards|spotlight|list|grid; services cards|pricing-grid|editorial-list|compact-grid; membership cards|comparison-table|stacked; music releases-grid|featured-release|list; contact cta|two-column|contact-cards.",
    "Incluí hero primero. Headline completo. Máximo 9 secciones. Colores #RRGGBB. No inventes URLs ni contenido dinámico.",
    "Devolvé exactamente:",
    `{ "mode": "${args.analysis.mode}", "sections": [{"type": string, "variant": string, "headline": string, "subheadline": string, "primaryLabel": string, "primaryIcon": string, "secondaryLabel": string, "secondaryIcon": string, "heading": string, "body": string, "items": [{"title": string, "description": string, "icon": string}]}], "page_style": {"theme":"dark"|"light"|"mixed","radius":string,"nav_style":"bar"|"pill","palette":{"background":string,"surface":string,"text":string,"muted_text":string,"accent":string,"border":string}}, "nav_items":[{"label":string,"section":string}], "footer":{"heading":string,"cta_label":string,"cta_section":string}|null }`,
  ].join("\n");

  const { parsed, costUsd } = await callGeminiJson({
    apiKey: args.apiKey,
    promptText,
    images: args.images,
    workload: args.analysis.mode === "reference_layout" ? "reference_precise" : "adaptive_layout",
  });
  return { layout: sanitizeLayoutConfig(parsed), costUsd };
}

type RawBox = { top: number; left: number; bottom: number; right: number };

function isRawBox(value: unknown): value is RawBox {
  if (!value || typeof value !== "object") return false;
  const box = value as Record<string, unknown>;
  return (["top", "left", "bottom", "right"] as const).every((key) => typeof box[key] === "number" && Number.isFinite(box[key]));
}

function resolveElementsAgainstBox(rawElements: unknown, containerBox: RawBox): unknown[] {
  if (!Array.isArray(rawElements)) return [];
  const containerWidth = Math.max(containerBox.right - containerBox.left, 1);
  const containerHeight = Math.max(containerBox.bottom - containerBox.top, 1);
  return rawElements
    .map((rawElement) => {
      if (!rawElement || typeof rawElement !== "object") return null;
      const element = { ...(rawElement as Record<string, unknown>) };
      const elementBox = element.box;
      if (!isRawBox(elementBox)) return null;
      element.x = ((elementBox.left - containerBox.left) / containerWidth) * 100;
      element.y = ((elementBox.top - containerBox.top) / containerHeight) * 100;
      element.w = ((elementBox.right - elementBox.left) / containerWidth) * 100;
      element.h = ((elementBox.bottom - elementBox.top) / containerHeight) * 100;
      delete element.box;
      return element;
    })
    .filter((element) => element !== null);
}

function resolveDecorationsAgainstBox(rawDecorations: unknown, containerBox: RawBox): unknown[] {
  if (!Array.isArray(rawDecorations)) return [];
  const containerWidth = Math.max(containerBox.right - containerBox.left, 1);
  const containerHeight = Math.max(containerBox.bottom - containerBox.top, 1);
  return rawDecorations
    .map((rawDecoration) => {
      if (!rawDecoration || typeof rawDecoration !== "object") return null;
      const decoration = { ...(rawDecoration as Record<string, unknown>) };
      const decorationBox = decoration.box;
      if (!isRawBox(decorationBox)) return null;
      decoration.x = ((decorationBox.left - containerBox.left) / containerWidth) * 100;
      decoration.y = ((decorationBox.top - containerBox.top) / containerHeight) * 100;
      decoration.w = ((decorationBox.right - decorationBox.left) / containerWidth) * 100;
      decoration.h = ((decorationBox.bottom - decorationBox.top) / containerHeight) * 100;
      delete decoration.box;
      return decoration;
    })
    .filter((decoration) => decoration !== null);
}

function resolvePreciseSection(rawSection: unknown, parentBox: RawBox | null): unknown {
  if (!rawSection || typeof rawSection !== "object") return null;
  const section = { ...(rawSection as Record<string, unknown>) };
  const sectionBox = section.box;
  if (!isRawBox(sectionBox)) return null;

  const referenceBox: RawBox = parentBox ?? { top: 0, left: 0, bottom: 1000, right: 1000 };
  const referenceWidth = Math.max(referenceBox.right - referenceBox.left, 1);
  section.xPct = ((sectionBox.left - referenceBox.left) / referenceWidth) * 100;
  section.widthPct = ((sectionBox.right - sectionBox.left) / referenceWidth) * 100;
  section.heightVh = ((sectionBox.bottom - sectionBox.top) / 1000) * 100;
  section.elements = resolveElementsAgainstBox(section.elements, sectionBox);
  section.decorations = resolveDecorationsAgainstBox(section.decorations, sectionBox);

  if (Array.isArray(section.columns)) {
    section.columns = section.columns
      .map((column) => resolvePreciseSection(column, sectionBox))
      .filter((column) => column !== null);
  }

  delete section.box;
  return section;
}

function resolvePreciseSectionBoxes(rawSections: unknown): unknown[] {
  if (!Array.isArray(rawSections)) return [];
  return rawSections.map((section) => resolvePreciseSection(section, null)).filter((section) => section !== null);
}

export async function generatePreciseLayoutConfig(args: {
  apiKey: string;
  images: GeminiReferenceImage[];
  analysis: ReferenceAnalysis;
  facts: Record<string, unknown>;
  copy: { tagline: string | null; short_bio: string | null };
  subjectLabel: "Player" | "Estudio";
}): Promise<{ layout: LayoutConfig | null; costUsd: number }> {
  const relevantIndexes = args.analysis.images.filter((image) => image.is_layout_relevant).map((image) => image.index);

  const promptText = [
    "Sos el extractor de geometría y estilo de Reference Fidelity V2 de CLOUVA.",
    "Tu trabajo NO es inspirarte: tratá el screenshot como TARGET VISUAL. Extraé la escena para que un renderer estructurado pueda acercarse lo máximo posible a su composición.",
    "NUNCA generes HTML, CSS, JSX, clases, URLs, scripts ni event handlers. Solo JSON con el vocabulario cerrado indicado abajo.",
    `Las imágenes en ${JSON.stringify(relevantIndexes)} son el target visual real.`,
    `Datos confirmados del ${args.subjectLabel}: ${JSON.stringify(args.facts)}`,
    `Copy aprobado: tagline=${JSON.stringify(args.copy.tagline)}, bio=${JSON.stringify(args.copy.short_bio)}. No copies marcas/textos ajenos del mockup.`,
    "",
    "COORDENADAS: cada section/element/decoration lleva box={top,left,bottom,right}, normalizado 0..1000 contra la imagen COMPLETA. Medí el rectángulo visible real, incluyendo ALTURA; no inventes cajas iguales para elementos diferentes.",
    `SECCIONES: ${LAYOUT_SECTION_TYPES.join(", ")}. Cada sección debe tener id estable kebab-case (ej. hero-main, lower-strip), type y box.`,
    `BACKGROUND opcional: {color:#RRGGBB,imageSlot:${IMAGE_SLOTS.join("|")},fit:${IMAGE_FITS.join("|")},position:${IMAGE_POSITIONS.join("|")},overlayOpacity:0..0.9}. overlayOpacity debe reflejar el oscurecido real; no agregues overlay si no existe.`,
    "",
    `ELEMENTOS ESTÁTICOS: type=${POSITIONED_ELEMENT_TYPES.join("|")}. Cada elemento requiere id estable kebab-case y box real.`,
    `Campos visuales seguros opcionales: fontSizePx 8..160, fontWeight=${FONT_WEIGHTS.join("|")}, color #RRGGBB, align=${TEXT_ALIGNS.join("|")}, letterSpacingPx -2..24, lineHeight 0.8..2.5, opacity 0..1, backgroundColor #RRGGBB, borderColor #RRGGBB, borderWidthPx 0..8, radiusPx 0..999, shadow=${SHADOW_PRESETS.join("|")}, blur=${BLUR_PRESETS.join("|")}, zIndex -10..50.`,
    `Para image: imageSlot=${IMAGE_SLOTS.join("|")}, imageFit=${IMAGE_FITS.join("|")}, imagePosition=${IMAGE_POSITIONS.join("|")}. Nunca URL.`,
    `Para button: action solo join|share|scroll:<section>; icon opcional ${LAYOUT_ICONS.join("|")}; buttonStyle ${BUTTON_STYLES.join("|")}. Detectá el radio real: si es rectangular NO uses pill por costumbre.`,
    'Mobile opcional por elemento: {"hidden":boolean,"order":number,"w":10..100,"align":"left"|"center"|"right"}. Derivá jerarquía móvil razonable; no copies coordenadas desktop a 390px.',
    "",
    `BLOQUES DINÁMICOS (${Array.from(["roster", "services", "membership", "gallery", "music"]).join(", ")}): no inventes registros. Usá styleHint={heading,cardStyle:${CARD_STYLES.join("|")},columns:1..6,gapPx:0..80,paddingPx:0..120,radiusPx:0..80,borderColor,backgroundColor,cardRadiusPx,cardBorderColor,cardBackgroundColor}. La section.box define su geometría; CLOUVA rellena datos reales.`,
    `DECORACIONES: type=${DECORATION_TYPES.join("|")}; cada una id+box y opcional zIndex/opacity/text (text solo vertical-label).`,
    "COLUMNS: cuando varios bloques comparten una misma franja horizontal, devolvé una sección padre con columns (máximo 4), cada columna con id/type/box y elements O styleHint. No conviertas una composición horizontal en secciones apiladas si el target no lo hace.",
    "",
    "FIDELIDAD: preservá relaciones espaciales, espacio negativo, escala relativa, solapes intencionales, tamaños de logo, proporción de cards y botones. No corrijas el diseño para hacerlo 'más lindo'. No uses defaults genéricos si el screenshot muestra otra cosa.",
    "",
    "Devolvé exactamente JSON de esta forma:",
    '{"schema_version":2,"mode":"reference_layout","layout_kind":"precise","precise_sections":[{"id":string,"type":string,"box":{"top":number,"left":number,"bottom":number,"right":number},"background":{"color":string,"imageSlot":string,"fit":string,"position":string,"overlayOpacity":number},"elements":[{"id":string,"type":string,"text":string,"box":{"top":number,"left":number,"bottom":number,"right":number},"zIndex":number,"fontSizePx":number,"fontWeight":number,"color":string,"align":string,"letterSpacingPx":number,"lineHeight":number,"opacity":number,"backgroundColor":string,"borderColor":string,"borderWidthPx":number,"radiusPx":number,"shadow":string,"blur":string,"action":string,"imageSlot":string,"imageFit":string,"imagePosition":string,"icon":string,"buttonStyle":string,"mobile":{"hidden":boolean,"order":number,"w":number,"align":string}}],"styleHint":{"heading":string,"cardStyle":string,"columns":number,"gapPx":number,"paddingPx":number,"radiusPx":number,"borderColor":string,"backgroundColor":string,"cardRadiusPx":number,"cardBorderColor":string,"cardBackgroundColor":string},"decorations":[{"id":string,"type":string,"box":{"top":number,"left":number,"bottom":number,"right":number},"zIndex":number,"opacity":number,"text":string}],"columns":["same section shape without nested columns"]}],"page_style":{"theme":"dark"|"light"|"mixed","radius":string,"nav_style":"bar"|"pill","header_overlay":boolean,"palette":{"background":string,"surface":string,"text":string,"muted_text":string,"accent":string,"border":string}},"nav_items":[{"label":string,"section":string}],"footer":{"heading":string,"cta_label":string,"cta_section":string}|null}',
    "Cada sección lleva elements O styleHint O columns. decorations puede coexistir. Omití campos opcionales que no puedas estimar en vez de inventarlos.",
  ].join("\n");

  const { parsed, costUsd } = await callGeminiJson({
    apiKey: args.apiKey,
    promptText,
    images: args.images,
    workload: "reference_precise",
  });
  const resolved = parsed && typeof parsed === "object"
    ? {
        ...(parsed as Record<string, unknown>),
        schema_version: 2,
        mode: "reference_layout",
        layout_kind: "precise",
        precise_sections: resolvePreciseSectionBoxes((parsed as Record<string, unknown>).precise_sections),
      }
    : parsed;
  return { layout: sanitizeLayoutConfig(resolved), costUsd };
}

export async function generateLayoutVariants(args: {
  apiKey: string;
  images: GeminiReferenceImage[];
  analysis: ReferenceAnalysis;
  facts: Record<string, unknown>;
  copy: { tagline: string | null; short_bio: string | null };
  subjectLabel: "Player" | "Estudio";
}): Promise<{ layouts: LayoutConfig[]; costUsd: number }> {
  const promptText = [
    "Sos un generador de layout estructurado para CLOUVA.",
    `Proponé 3 composiciones DISTINTAS para ${args.subjectLabel}. No son mockups web: las imágenes solo inspiran estética. Nunca HTML/CSS/JSX.`,
    `Resumen: ${args.analysis.summary ?? "(sin resumen)"}`,
    `Datos: ${JSON.stringify(args.facts)}`,
    `Copy aprobado: tagline=${JSON.stringify(args.copy.tagline)}, bio=${JSON.stringify(args.copy.short_bio)}`,
    "Las tres variantes deben diferir realmente en hero, paleta, orden/selección de secciones. Incluí hero primero; headline completo; máximo 9 secciones; colores #RRGGBB.",
    "Secciones/variantes: hero centered|split|editorial|full-bleed|overlay; about simple|editorial|image-left|image-right; pillars 3-cards|4-cards|icon-grid; gallery grid|masonry|strip|collage-clean; roster cards|spotlight|list|grid; services cards|pricing-grid|editorial-list|compact-grid; membership cards|comparison-table|stacked; music releases-grid|featured-release|list; contact cta|two-column|contact-cards.",
    "Devolvé exactamente:",
    '{"variants":[{"sections":[{"type":string,"variant":string,"headline":string,"subheadline":string,"primaryLabel":string,"primaryIcon":string,"secondaryLabel":string,"secondaryIcon":string,"heading":string,"body":string,"items":[{"title":string,"description":string,"icon":string}]}],"page_style":{"theme":"dark"|"light"|"mixed","radius":string,"nav_style":"bar"|"pill","palette":{"background":string,"surface":string,"text":string,"muted_text":string,"accent":string,"border":string}},"nav_items":[{"label":string,"section":string}]},{"...":"segunda variante"},{"...":"tercera variante"}]}',
  ].join("\n");

  const { parsed, costUsd } = await callGeminiJson({
    apiKey: args.apiKey,
    promptText,
    images: args.images,
    workload: "adaptive_layout",
  });
  const rawVariants = parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).variants)
    ? (parsed as Record<string, unknown>).variants as unknown[]
    : [];
  const layouts = rawVariants
    .map((variant) => sanitizeLayoutConfig({ ...(variant as Record<string, unknown>), mode: "adaptive_layout" }))
    .filter((layout): layout is LayoutConfig => layout !== null)
    .slice(0, 3);

  return { layouts, costUsd };
}
