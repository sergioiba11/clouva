import "server-only";
import type { GeminiReferenceImage } from "@/lib/gemini-image";
import { sanitizeLayoutConfig, type LayoutConfig } from "./layout-config";

// Mismo patrón REST+JSON-mode que vip-profile-gemini.ts (generateProfileCopy)
// combinado con el patrón inlineData de referencia de gemini-image.ts -- acá
// no generamos una imagen, generamos JSON estructurado a partir de imágenes,
// así que no usamos generateImage() (que pide responseModalities TEXT+IMAGE).
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = "gemini-3.1-flash-lite";
const INPUT_PRICE_PER_MILLION = 0.1;
const OUTPUT_PRICE_PER_MILLION = 0.4;

export class LayoutGeminiError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

async function callGeminiJson(args: { apiKey: string; promptText: string; images: GeminiReferenceImage[] }) {
  const parts: Array<Record<string, unknown>> = [{ text: args.promptText }];
  for (const image of args.images) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });

  const response = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": args.apiKey },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(45 * 1000),
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

  const text = data.candidates?.[0]?.content?.parts?.find((p) => typeof p.text === "string")?.text;
  if (!text) throw new LayoutGeminiError("Gemini no devolvió texto.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LayoutGeminiError("No se pudo interpretar la respuesta de Gemini como JSON.");
  }

  const promptTokens = data.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
  const costUsd = Number(((promptTokens / 1_000_000) * INPUT_PRICE_PER_MILLION + (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION).toFixed(6));

  return { parsed, costUsd };
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

// Prompt 1 del spec del usuario: clasifica cada imagen subida y decide si hay
// suficiente referencia de web real (reference_layout) o si hay que adaptar
// fotos/branding/moodboards a una web original (adaptive_layout). No genera
// el layout todavía -- solo clasifica y decide el modo.
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
    "Tu tarea es analizar una o varias imágenes subidas por el usuario y devolver ÚNICAMENTE JSON válido, sin texto alrededor.",
    "No generás HTML, CSS ni código. No inventás información que no esté en los datos entregados.",
    "",
    `Datos confirmados del ${args.subjectLabel} (único material permitido para razonar sobre contenido, no sobre las imágenes): ${JSON.stringify(args.facts)}`,
    "",
    `Se te adjuntan ${args.images.length} imagen(es), en orden, índice 0 en adelante.`,
    "Cada imagen puede ser: web_mockup (screenshot o mockup de una página web real), ui_reference (fragmento de interfaz/diseño web), brand_reference (branding/identidad, no una web completa), studio_photo (foto real del lugar/estudio), artist_photo (foto de personas/artistas), moodboard, flyer, u other.",
    "",
    "REGLAS PARA DECIDIR EL MODO:",
    "- Si una o más imágenes muestran claramente estructura de página web (navbar, hero, secciones, cards, footer, layout editorial reconocible), el modo es \"reference_layout\".",
    "- Si ninguna imagen muestra una web reconocible (son fotos, branding, moodboards, flyers), el modo es \"adaptive_layout\".",
    "",
    "Devolvé exactamente este JSON:",
    "{",
    '  "mode": "reference_layout" | "adaptive_layout",',
    '  "confidence": number,',
    '  "summary": string,',
    '  "images": [',
    '    { "index": number, "category": "web_mockup" | "ui_reference" | "brand_reference" | "studio_photo" | "artist_photo" | "moodboard" | "flyer" | "other", "notes": string }',
    "  ]",
    "}",
  ].join("\n");

  const { parsed, costUsd } = await callGeminiJson({ apiKey: args.apiKey, promptText, images: args.images });
  return { analysis: sanitizeAnalysis(parsed, args.images.length), costUsd };
}

// Prompt 2/3 del spec del usuario, fusionados en un único resultado (no las
// 3 variantes todavía -- eso es una fase posterior, deliberadamente fuera de
// esta corrida): genera el layout_config final, fiel a la referencia si el
// modo es reference_layout, o una composición original y coherente si es
// adaptive_layout. Siempre devuelve el mismo esquema fijo
// (lib/server/layout-config.ts) sanitizado antes de persistirse.
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
    "Sos un generador de layout estructurado para CLOUVA.",
    "Tu tarea es convertir referencias visuales en un JSON estructurado llamado layout_config, que después renderiza un componente React fijo -- vos NUNCA generás HTML, CSS ni JSX, solo datos.",
    "",
    `Modo: "${args.analysis.mode}".`,
    args.analysis.mode === "reference_layout"
      ? `Las imágenes en los índices ${JSON.stringify(relevantIndexes)} son mockups/referencias de una web real -- reconstruí ese layout lo más fiel posible en orden de secciones, jerarquía y composición, usando solo el vocabulario permitido abajo. No copies texto ilegible ni marcas ajenas; el copy debe basarse en los datos del ${args.subjectLabel} entregados.`
      : `No hay una web de referencia clara. Las imágenes (si las hay) son fotos/branding/moodboards -- usalas como inspiración estética (paleta, energía, tono), y armá una página original, funcional y con buena jerarquía a partir de los datos del ${args.subjectLabel}.`,
    "",
    `Resumen del análisis previo: ${args.analysis.summary ?? "(sin resumen)"}`,
    `Datos confirmados del ${args.subjectLabel}: ${JSON.stringify(args.facts)}`,
    `Copy ya aprobado (usalo tal cual para hero/about, no lo reescribas): tagline=${JSON.stringify(args.copy.tagline)}, bio=${JSON.stringify(args.copy.short_bio)}`,
    "",
    "SECCIONES PERMITIDAS (usá solo estos valores de \"type\"): hero, about, pillars, gallery, roster, services, membership, music, contact.",
    "VARIANTES PERMITIDAS POR SECCIÓN -- elegí la que mejor represente la composición real de la referencia (si es reference_layout) o la identidad del Estudio (si es adaptive_layout), no uses siempre la misma:",
    "- hero: \"centered\" (imagen chica centrada, compacta) | \"split\" (imagen a un costado, texto al otro, en columnas) | \"editorial\" (sin imagen de fondo dominante, título tipo tapa de revista) | \"full-bleed\" (imagen a pantalla completa de punta a punta, título grande abajo) | \"overlay\" (imagen con oscurecido fuerte, logo insignia, título centrado tipo cine)",
    "- about: simple | editorial | image-left | image-right",
    "- pillars: \"3-cards\" | \"4-cards\" (tarjetas con borde) | \"icon-grid\" (lista numerada grande, sin tarjetas)",
    "- gallery: grid | masonry | strip | collage-clean",
    "- roster: cards | spotlight | list | grid",
    "- services: cards | pricing-grid | editorial-list | compact-grid",
    "- membership: cards | comparison-table | stacked",
    "- music: \"releases-grid\" (grilla de lanzamientos) | \"featured-release\" (uno solo destacado) | \"list\" (lista compacta)",
    "- contact: cta | two-column | contact-cards",
    "",
    "REGLAS:",
    "- Incluí \"hero\" siempre, primero. Si el modo es reference_layout, la variante de hero tiene que coincidir con lo que muestra la imagen (¿la portada ocupa toda la pantalla? ¿está partida en columnas? ¿el texto está centrado o a un lado?) -- no uses \"centered\" por defecto si la referencia es claramente otra cosa.",
    "- \"nav_style\": \"bar\" (barra sólida de ancho completo, más editorial/formal) o \"pill\" (navegación flotante en cápsula, más liviana) -- elegí la que se parezca más a la referencia, o \"pill\" si no hay referencia clara.",
    "- \"radius\": \"none\" | \"small\" | \"medium\" | \"large\" -- qué tan filosos o redondeados son los bordes en la referencia (o un valor coherente con el tono del Estudio si no hay referencia).",
    "- Incluí \"roster\", \"services\", \"membership\", \"gallery\" y \"contact\" solo si tiene sentido con los datos entregados -- el renderer ya se encarga de esconderlas si no hay datos reales, así que podés incluirlas de todos modos si aportan a la estructura.",
    "- \"music\" (\"Música y lanzamientos\") se alimenta de los lanzamientos reales que ya tiene cargados el Estudio, no de URLs que vos inventes -- incluila si la referencia muestra un reproductor/sección de música o si el Estudio es claramente musical, el renderer la oculta solo si no hay lanzamientos reales.",
    "- \"pillars\" necesita entre 2 y 4 items con title+description cortos, basados en los datos reales (servicios, disciplinas, valores mencionados) -- nunca inventados de la nada.",
    "- \"footer\" es opcional: solo si aporta (ej. un CTA final de cierre apuntando a una de las secciones incluidas).",
    "- No más de 9 secciones en total.",
    "- Los colores de page_style.palette deben ser hex de 6 dígitos (#RRGGBB), coherentes entre sí.",
    "",
    "Devolvé exactamente este JSON, sin texto alrededor:",
    "{",
    `  "mode": "${args.analysis.mode}",`,
    '  "sections": [ { "type": string, "variant": string, "headline": string, "subheadline": string, "heading": string, "body": string, "items": [{"title": string, "description": string}] } ],',
    '  "page_style": { "theme": "dark" | "light" | "mixed", "radius": string, "nav_style": "bar" | "pill", "palette": { "background": string, "surface": string, "text": string, "muted_text": string, "accent": string, "border": string } },',
    '  "nav_items": [ { "label": string, "section": string } ],',
    '  "footer": { "heading": string, "cta_label": string, "cta_section": string } | null',
    "}",
    "(Cada sección solo lleva los campos que le correspondan a su \"type\", como en el esquema del renderer -- no incluyas campos que no apliquen.)",
  ].join("\n");

  const { parsed, costUsd } = await callGeminiJson({ apiKey: args.apiKey, promptText, images: args.images });
  return { layout: sanitizeLayoutConfig(parsed), costUsd };
}
