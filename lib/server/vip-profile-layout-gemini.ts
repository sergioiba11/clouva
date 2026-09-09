import "server-only";
import type { GeminiReferenceImage } from "@/lib/gemini-image";
import {
  BLUR_PRESETS,
  BUTTON_STYLES,
  CARD_STYLES,
  DECORATION_TYPES,
  DYNAMIC_VARIANTS,
  DYNAMIC_WIDGET_TYPES,
  FONT_FAMILY_TOKENS,
  FONT_WEIGHTS,
  HEADER_ALIGNMENTS,
  HEADER_MODES,
  IMAGE_FITS,
  IMAGE_POSITIONS,
  IMAGE_SLOTS,
  LAYOUT_ICONS,
  LAYOUT_SECTION_TYPES,
  POSITIONED_ELEMENT_TYPES,
  SHADOW_PRESETS,
  TEXT_ALIGNS,
  TEXT_TRANSFORMS,
  sanitizeLayoutConfig,
  type LayoutConfig,
} from "./layout-config";
import { getGeminiLayoutModelPolicy, type GeminiLayoutWorkload } from "./gemini-layout-model-policy";
import { inferReferenceViewport, type ReferenceViewport } from "./reference-fidelity-v3";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export class LayoutGeminiError extends Error {
  status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}

export async function callGeminiJson(args: { apiKey: string; promptText: string; images: GeminiReferenceImage[]; workload?: GeminiLayoutWorkload }) {
  const workload = args.workload ?? "adaptive_layout";
  const policy = getGeminiLayoutModelPolicy(workload);
  const parts: Array<Record<string, unknown>> = [{ text: args.promptText }];
  for (const image of args.images) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  const response = await fetch(`${ENDPOINT}/${policy.model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": args.apiKey },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json", temperature: policy.temperature, maxOutputTokens: workload === "reference_precise" ? 32_768 : 8_192 } }),
    cache: "no-store",
    signal: AbortSignal.timeout(policy.timeoutMs),
  });
  const raw = await response.text();
  let data: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }; error?: { message?: string } } = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { throw new LayoutGeminiError("Gemini devolvió una respuesta inválida."); }
  if (!response.ok) throw new LayoutGeminiError(data.error?.message ?? `Gemini respondió HTTP ${response.status}`, response.status);
  const text = data.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;
  if (!text) throw new LayoutGeminiError("Gemini no devolvió texto.");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new LayoutGeminiError("No se pudo interpretar la respuesta de Gemini como JSON."); }
  const promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
  const costUsd = Number(((promptTokens / 1_000_000) * policy.inputPricePerMillion + (outputTokens / 1_000_000) * policy.outputPricePerMillion).toFixed(6));
  return { parsed, costUsd, model: policy.model };
}

export const IMAGE_CATEGORIES = ["web_mockup", "ui_reference", "brand_reference", "studio_photo", "artist_photo", "moodboard", "flyer", "other"] as const;
export type ImageCategory = (typeof IMAGE_CATEGORIES)[number];
export type ImageClassification = { index: number; category: ImageCategory; is_layout_relevant: boolean; notes: string | null };
export type ReferenceAnalysis = { mode: "reference_layout" | "adaptive_layout"; confidence: number; summary: string | null; images: ImageClassification[] };

function sanitizeAnalysis(raw: unknown, imageCount: number): ReferenceAnalysis {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const mode = value.mode === "reference_layout" ? "reference_layout" : "adaptive_layout";
  const confidence = typeof value.confidence === "number" && value.confidence >= 0 && value.confidence <= 1 ? value.confidence : .5;
  const summary = typeof value.summary === "string" ? value.summary.trim().slice(0, 500) : null;
  const rows = Array.isArray(value.images) ? value.images : [];
  const images: ImageClassification[] = [];
  for (let index = 0; index < imageCount; index += 1) {
    const entry = rows.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).index === index) as Record<string, unknown> | undefined;
    const category = entry && IMAGE_CATEGORIES.includes(entry.category as ImageCategory) ? entry.category as ImageCategory : "other";
    images.push({ index, category, is_layout_relevant: category === "web_mockup" || category === "ui_reference", notes: entry && typeof entry.notes === "string" ? entry.notes.trim().slice(0, 200) : null });
  }
  return { mode, confidence, summary, images };
}

export async function analyzeReferenceImages(args: { apiKey: string; images: GeminiReferenceImage[]; facts: Record<string, unknown>; subjectLabel: "Player" | "Estudio" }): Promise<{ analysis: ReferenceAnalysis; costUsd: number }> {
  if (!args.images.length) return { analysis: { mode: "adaptive_layout", confidence: 1, summary: "Sin imágenes de referencia.", images: [] }, costUsd: 0 };
  const promptText = [
    "Sos el clasificador visual de CLOUVA. Devolvé solo JSON; nunca HTML/CSS/JS/JSX ni datos inventados.",
    `Datos confirmados del ${args.subjectLabel}: ${JSON.stringify(args.facts)}`,
    `Hay ${args.images.length} imagen(es), índice 0 en adelante.`,
    `Categorías permitidas: ${IMAGE_CATEGORIES.join(", ")}.`,
    "web_mockup/ui_reference requieren estructura de web/UI reconocible (header/nav/hero/secciones/cards/footer). Una foto del espacio, flyer, logo o moodboard NO es web aunque tenga texto.",
    "Si al menos una referencia es web_mockup/ui_reference elegí reference_layout; si no, adaptive_layout.",
    '{"mode":"reference_layout"|"adaptive_layout","confidence":number,"summary":string,"images":[{"index":number,"category":string,"notes":string}]}',
  ].join("\n");
  const { parsed, costUsd } = await callGeminiJson({ apiKey: args.apiKey, promptText, images: args.images, workload: "classification" });
  return { analysis: sanitizeAnalysis(parsed, args.images.length), costUsd };
}

export async function generateLayoutConfig(args: { apiKey: string; images: GeminiReferenceImage[]; analysis: ReferenceAnalysis; facts: Record<string, unknown>; copy: { tagline: string | null; short_bio: string | null }; subjectLabel: "Player" | "Estudio" }): Promise<{ layout: LayoutConfig | null; costUsd: number }> {
  const promptText = [
    "Sos un generador de layout estructurado para CLOUVA. Nunca HTML/CSS/JSX, solo layout_config.",
    `Modo: ${args.analysis.mode}. Datos confirmados: ${JSON.stringify(args.facts)}.`,
    `Copy aprobado: ${JSON.stringify(args.copy)}. No inventes URLs ni registros.`,
    "Secciones permitidas: hero, about, pillars, gallery, roster, services, membership, music, contact. Incluí hero primero. Máximo 9 secciones.",
    '{"mode":"adaptive_layout","layout_kind":"template","sections":[{"type":string,"variant":string,"headline":string,"subheadline":string,"primaryLabel":string,"heading":string,"body":string,"items":[{"title":string,"description":string}]}],"page_style":{"theme":"dark"|"light"|"mixed","radius":"none"|"small"|"medium"|"large","nav_style":"bar"|"pill","palette":{"background":string,"surface":string,"text":string,"muted_text":string,"accent":string,"border":string}},"nav_items":[{"label":string,"section":string}]}',
  ].join("\n");
  const { parsed, costUsd } = await callGeminiJson({ apiKey: args.apiKey, promptText, images: args.images, workload: "adaptive_layout" });
  return { layout: sanitizeLayoutConfig(parsed), costUsd };
}

type RawBox = { top: number; left: number; bottom: number; right: number };
function isRawBox(value: unknown): value is RawBox { if (!value || typeof value !== "object") return false; const b = value as Record<string, unknown>; return (["top","left","bottom","right"] as const).every((k)=>typeof b[k] === "number" && Number.isFinite(b[k])); }
function normalizeElementBoxes(raw: unknown, box: RawBox) {
  if (!Array.isArray(raw)) return [];
  const w = Math.max(box.right-box.left,1), h=Math.max(box.bottom-box.top,1);
  return raw.map((item)=>{ if(!item||typeof item!=="object")return null; const e={...(item as Record<string,unknown>)}; if(!isRawBox(e.box))return null; const eb=e.box; e.x=(eb.left-box.left)/w*100;e.y=(eb.top-box.top)/h*100;e.w=(eb.right-eb.left)/w*100;e.h=(eb.bottom-eb.top)/h*100;delete e.box;return e; }).filter(Boolean);
}
function normalizeDecorationBoxes(raw: unknown, box: RawBox) { return normalizeElementBoxes(raw, box); }
function normalizeSection(raw: unknown, viewport: ReferenceViewport, parent: RawBox | null): unknown {
  if(!raw||typeof raw!=="object")return null; const s={...(raw as Record<string,unknown>)}; if(!isRawBox(s.box))return null; const sb=s.box;
  const ref=parent??{top:0,left:0,bottom:viewport.height,right:viewport.width}, refWidth=Math.max(ref.right-ref.left,1);
  s.xPct=(sb.left-ref.left)/refWidth*100; s.widthPct=(sb.right-sb.left)/refWidth*100;
  s.heightVh=(sb.bottom-sb.top)/viewport.height*100;
  s.elements=normalizeElementBoxes(s.elements,sb); s.decorations=normalizeDecorationBoxes(s.decorations,sb);
  if(Array.isArray(s.columns))s.columns=s.columns.map((c)=>normalizeSection(c,viewport,sb)).filter(Boolean);
  delete s.box; return s;
}
function normalizePreciseOutput(parsed: unknown, viewport: ReferenceViewport) {
  if(!parsed||typeof parsed!=="object")return parsed; const obj=parsed as Record<string,unknown>;
  return { ...obj, schema_version:3, mode:"reference_layout", layout_kind:"precise", reference_viewport:viewport, precise_sections:Array.isArray(obj.precise_sections)?obj.precise_sections.map((s)=>normalizeSection(s,viewport,null)).filter(Boolean):[] };
}

function preciseVocabulary(viewport: ReferenceViewport) {
  return [
    `TARGET VIEWPORT REAL: ${viewport.width}x${viewport.height} px (aspect ${viewport.aspectRatio}). Todas las box usan PIXELES REALES de ese target, NO canvas 1000x1000.`,
    `Secciones=${LAYOUT_SECTION_TYPES.join("|")}. Cada sección: id kebab-case + type + box={top,left,bottom,right} en px.`,
    `Elementos=${POSITIONED_ELEMENT_TYPES.join("|")}. Cada elemento: id estable + box.`,
    `Tipografía segura: fontFamilyToken=${FONT_FAMILY_TOKENS.join("|")}; fontWeight=${FONT_WEIGHTS.join("|")}; textTransform=${TEXT_TRANSFORMS.join("|")}; align=${TEXT_ALIGNS.join("|")}.`,
    `Imágenes: SOLO imageSlot semántico, nunca URL. Slots base=${IMAGE_SLOTS.join("|")} y familias pillar-N|gallery-N|player-N|release-N|service-N|membership-N|background-N|media-N|project-N (N 0..15). fit=${IMAGE_FITS.join("|")}; position=${IMAGE_POSITIONS.join("|")}.`,
    `Dynamic widgets=${DYNAMIC_WIDGET_TYPES.join("|")}; variant=${DYNAMIC_VARIANTS.join("|")}; opcional dataIndex, columns, gapPx. El widget recibe DATOS REALES; jamás copies nombres/precios/canciones del target.`,
    `Button: action solo join|share|scroll:<section>; style=${BUTTON_STYLES.join("|")}; icon=${LAYOUT_ICONS.join("|")}.`,
    `Decoraciones=${DECORATION_TYPES.join("|")}; shadow=${SHADOW_PRESETS.join("|")}; blur=${BLUR_PRESETS.join("|")}.`,
    `Header V2: mode=${HEADER_MODES.join("|")}, dimensiones/posición/fondo/blur/border/radius; brand imageSlot/showText/widthPx/heightPx/fit; nav align=${HEADER_ALIGNMENTS.join("|")}/gap/font token/size/uppercase; cta label+acción segura+buttonStyle.`,
    `Bloques dinámicos de sección pueden usar styleHint {heading,cardStyle:${CARD_STYLES.join("|")},columns,gapPx,paddingPx,radiusPx,borderColor,backgroundColor,cardRadiusPx,cardBorderColor,cardBackgroundColor}.`,
    "Mobile por elemento: {hidden,order,w,align}; mantené jerarquía, no comprimas coordenadas desktop literal a 390px.",
  ];
}

export async function generatePreciseLayoutConfig(args: { apiKey: string; images: GeminiReferenceImage[]; analysis: ReferenceAnalysis; facts: Record<string, unknown>; copy: { tagline: string | null; short_bio: string | null }; subjectLabel: "Player" | "Estudio" }): Promise<{ layout: LayoutConfig | null; costUsd: number }> {
  const indexes=args.analysis.images.filter((i)=>i.is_layout_relevant).map((i)=>i.index); const target=args.images[indexes[0]??0]??args.images[0]; const viewport=inferReferenceViewport(target)??{width:1440,height:900,aspectRatio:1.6};
  const promptText=[
    "Sos el extractor de Reference Fidelity V3 de CLOUVA. El screenshot es TARGET VISUAL, no inspiración.",
    "RECONSTRUÍ la composición observada con el vocabulario estructurado cerrado. No la hagas más linda, no la reinterpretes.",
    "PROHIBIDO: HTML, CSS, JSX, JS, className, style libre, handlers, iframes, URLs inventadas, fonts remotas, datos ficticios o copiar textos/marcas del screenshot cuando contradicen los datos reales.",
    `Datos confirmados del ${args.subjectLabel}: ${JSON.stringify(args.facts)}`,
    `Copy real aprobado: ${JSON.stringify(args.copy)}.`,
    ...preciseVocabulary(viewport),
    "Preservá geometría global, espacio negativo, header, hero, cards, solapes, proporción de logos/botones e imágenes.",
    "Usá dynamic widgets para contenido real (Players, lanzamientos, servicios, membresías, media) cuando el target muestre componentes de ese tipo.",
    "Máximo 9 secciones, 32 elementos por sección, 4 columnas anidadas. Omití lo que no puedas medir; no inventes defaults visuales.",
    "Devolvé JSON con schema_version=3, mode=reference_layout, layout_kind=precise, header opcional, precise_sections, page_style, nav_items y footer. Las secciones/elementos/decoraciones usan box en px reales.",
  ].join("\n");
  const {parsed,costUsd}=await callGeminiJson({apiKey:args.apiKey,promptText,images:args.images,workload:"reference_precise"});
  return {layout:sanitizeLayoutConfig(normalizePreciseOutput(parsed,viewport)),costUsd};
}

export async function regeneratePreciseLayoutStructure(args: { apiKey:string; target:GeminiReferenceImage; render:GeminiReferenceImage; currentLayout:LayoutConfig; analysis:ReferenceAnalysis|null; facts:Record<string,unknown>; copy:{tagline:string|null;short_bio:string|null} }):Promise<{layout:LayoutConfig|null;costUsd:number;model:string}> {
  const viewport=args.currentLayout.reference_viewport??inferReferenceViewport(args.target)??{width:1440,height:900,aspectRatio:1.6};
  const promptText=[
    "Sos la ÚNICA pasada de REGENERACIÓN ESTRUCTURAL de Reference Fidelity V3.",
    "Imagen 0=TARGET ORIGINAL. Imagen 1=RENDER ACTUAL. El comparador ya determinó que pequeños deltas no alcanzan.",
    "No rediseñes ni inventes contenido. Reconstruí SOLAMENTE layout_config structured precise para corregir estructura global.",
    "PROHIBIDO HTML/CSS/JS/JSX/URLs/fonts remotas/datos ficticios. Mantené componentes reales mediante widgets semánticos.",
    `Viewport: ${JSON.stringify(viewport)}.`,
    `Análisis anterior: ${JSON.stringify(args.analysis)}`,
    `Datos reales: ${JSON.stringify(args.facts)}`,
    `Copy real: ${JSON.stringify(args.copy)}`,
    `Layout actual: ${JSON.stringify(args.currentLayout)}`,
    ...preciseVocabulary(viewport),
    "Conservá IDs existentes cuando el mismo elemento sigue existiendo. Para elementos realmente nuevos usá IDs kebab-case estables.",
    "Devolvé solo el layout JSON schema_version=3. Las box están en px del TARGET.",
  ].join("\n");
  const {parsed,costUsd,model}=await callGeminiJson({apiKey:args.apiKey,promptText,images:[args.target,args.render],workload:"reference_precise"});
  return {layout:sanitizeLayoutConfig(normalizePreciseOutput(parsed,viewport)),costUsd,model};
}

export async function generateLayoutVariants(args: {
  apiKey:string;
  images:GeminiReferenceImage[];
  analysis:ReferenceAnalysis;
  facts:Record<string,unknown>;
  copy:{tagline:string|null;short_bio:string|null};
  subjectLabel:"Player"|"Estudio";
  creativeDirection?:string|null;
}):Promise<{layouts:LayoutConfig[];costUsd:number}> {
  const direction=args.creativeDirection?.trim().slice(0,280)||null;
  const promptText=[
    "Sos un generador de 3 layouts estructurados distintos para CLOUVA. Nunca HTML/CSS/JSX.",
    `Datos reales del ${args.subjectLabel}: ${JSON.stringify(args.facts)}.`,
    `Copy real: ${JSON.stringify(args.copy)}.`,
    direction ? `Dirección creativa explícita del usuario: ${JSON.stringify(direction)}.` : "No hay texto creativo explícito; inferí la atmósfera únicamente de las imágenes provistas y del branding real.",
    args.images.length ? "Las imágenes adjuntas son inspiración/branding/fotos reales, NO un mockup web. Extraé paleta, contraste, temperatura, energía, formas y textura sin copiarlas como fondo literal." : "No hay imagen temática; construí la dirección desde el texto y los datos reales.",
    "No hay target web preciso: proponé EXACTAMENTE 3 variantes de la MISMA web del MISMO Studio/Player. No cambies datos, nombre, Players, servicios, releases ni membresías entre variantes.",
    "Las tres deben diferir de verdad en composición, jerarquía, ritmo, tratamiento gráfico, radius/nav_style y distribución de secciones, pero seguir la misma temática solicitada.",
    "Pensalas como tres direcciones: 1) cinematográfica/expresiva, 2) editorial/premium, 3) contemporánea/experimental, adaptadas al input real. No uses esas etiquetas si contradicen la dirección del usuario.",
    "Máximo 9 secciones. No inventes URLs. No generes imágenes. Solo layout_config seguro.",
    '{"variants":[{"mode":"adaptive_layout","layout_kind":"template","sections":[],"page_style":{},"nav_items":[]}]}',
  ].join("\n");
  const {parsed,costUsd}=await callGeminiJson({apiKey:args.apiKey,promptText,images:args.images,workload:"adaptive_layout"});
  const raw=parsed&&typeof parsed==="object"&&Array.isArray((parsed as Record<string,unknown>).variants)?(parsed as Record<string,unknown>).variants as unknown[]:[];
  return {layouts:raw.map((v)=>sanitizeLayoutConfig({...v as Record<string,unknown>,mode:"adaptive_layout",layout_kind:"template"})).filter((v):v is LayoutConfig=>v!==null).slice(0,3),costUsd};
}
