import "server-only";
import type { GeminiReferenceImage } from "@/lib/gemini-image";
import {
  CARD_STYLES,
  FONT_WEIGHTS,
  IMAGE_SLOTS,
  LAYOUT_SECTION_TYPES,
  POSITIONED_ELEMENT_TYPES,
  TEXT_ALIGNS,
  sanitizeLayoutConfig,
  type LayoutConfig,
} from "./layout-config";

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
    "- \"headline\" del hero SIEMPRE tiene que ser una frase completa y autosuficiente por sí sola (ej. \"El Iglú Records\", no \"Bienvenido a\"). Nunca la cortes a mitad de frase asumiendo que \"subheadline\" la termina -- subheadline es una línea aparte, opcional, no la continuación gramatical del headline.",
    "- El hero puede incluir \"primaryLabel\"/\"secondaryLabel\": el texto real de hasta 2 botones (cortos, imperativos, ej. \"Conocer el estudio\", \"Escuchar música\") -- si es reference_layout y la referencia muestra botones con texto propio, usá ese texto o algo muy cercano. \"primaryIcon\"/\"secondaryIcon\" son opcionales y SOLO pueden ser uno de: sparkles, play, users, music, heart, arrow-right, mic, calendar, headphones, star -- nunca otro valor, y solo si de verdad suma (no fuerces un ícono si el botón no lo necesita).",
    "- \"nav_style\": \"bar\" (barra sólida de ancho completo, más editorial/formal) o \"pill\" (navegación flotante en cápsula, más liviana) -- elegí la que se parezca más a la referencia, o \"pill\" si no hay referencia clara.",
    "- \"radius\": \"none\" | \"small\" | \"medium\" | \"large\" -- qué tan filosos o redondeados son los bordes en la referencia (o un valor coherente con el tono del Estudio si no hay referencia).",
    "- Incluí \"roster\", \"services\", \"membership\", \"gallery\" y \"contact\" solo si tiene sentido con los datos entregados -- el renderer ya se encarga de esconderlas si no hay datos reales, así que podés incluirlas de todos modos si aportan a la estructura.",
    "- \"music\" (\"Música y lanzamientos\") se alimenta de los lanzamientos reales que ya tiene cargados el Estudio, no de URLs que vos inventes -- incluila si la referencia muestra un reproductor/sección de música o si el Estudio es claramente musical, el renderer la oculta solo si no hay lanzamientos reales.",
    "- \"pillars\" necesita entre 2 y 4 items con title+description cortos, basados en los datos reales (servicios, disciplinas, valores mencionados) -- nunca inventados de la nada. Cada item puede llevar opcionalmente \"icon\", SOLO uno de: sparkles, play, users, music, heart, arrow-right, mic, calendar, headphones, star.",
    "- \"footer\" es opcional: solo si aporta (ej. un CTA final de cierre apuntando a una de las secciones incluidas).",
    "- No más de 9 secciones en total.",
    "- Los colores de page_style.palette deben ser hex de 6 dígitos (#RRGGBB), coherentes entre sí.",
    "",
    "Devolvé exactamente este JSON, sin texto alrededor:",
    "{",
    `  "mode": "${args.analysis.mode}",`,
    '  "sections": [ { "type": string, "variant": string, "headline": string, "subheadline": string, "primaryLabel": string, "primaryIcon": string, "secondaryLabel": string, "secondaryIcon": string, "heading": string, "body": string, "items": [{"title": string, "description": string, "icon": string}] } ],',
    '  "page_style": { "theme": "dark" | "light" | "mixed", "radius": string, "nav_style": "bar" | "pill", "palette": { "background": string, "surface": string, "text": string, "muted_text": string, "accent": string, "border": string } },',
    '  "nav_items": [ { "label": string, "section": string } ],',
    '  "footer": { "heading": string, "cta_label": string, "cta_section": string } | null',
    "}",
    "(Cada sección solo lleva los campos que le correspondan a su \"type\", como en el esquema del renderer -- no incluyas campos que no apliquen. primaryLabel/primaryIcon/secondaryLabel/secondaryIcon solo aplican a \"hero\", y son opcionales.)",
  ].join("\n");

  const { parsed, costUsd } = await callGeminiJson({ apiKey: args.apiKey, promptText, images: args.images });
  return { layout: sanitizeLayoutConfig(parsed), costUsd };
}

// Pedido explícito del usuario: para reference_layout, "que cope el layout
// pixel por pixel" -- el esquema de arriba (sections/variant) por diseño
// aproxima (elige entre un puñado de variantes fijas), nunca replica exacto.
// Esta función pide en cambio geometría real por elemento (posición/tamaño/
// tipografía/color, normalizados como porcentaje) en vez de una categoría --
// sigue siendo 100% datos estructurados (números + enums cerrados) que
// sanitizeLayoutConfig() revalida entero, nunca HTML/CSS/JSX libre. Se usa
// SOLO cuando el modo es reference_layout (hay un mockup real del cual
// copiar) -- adaptive_layout sigue con generateLayoutVariants() de arriba,
// sin mockup no hay nada que replicar pixel por pixel.
// Gemini está entrenado para detección espacial en formato "box_2d":
// [ymin, xmin, ymax, xmax] normalizado 0-1000 RELATIVO A LA IMAGEN COMPLETA
// -- pedirle eso (en vez de pedirle que calcule porcentajes relativos a una
// sub-región que él mismo tiene que imaginar) es mucho más confiable. La
// conversión a "x/y/w relativos a la sección" (lo que espera el esquema)
// la hacemos acá con matemática simple, nunca se la pedimos al modelo.
type RawBox = [number, number, number, number];

function isRawBox(value: unknown): value is RawBox {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === "number" && Number.isFinite(n));
}

// Convierte los "box" (0-1000, relativos a toda la imagen) que devolvió
// Gemini en los x/y/w (0-100, relativos a su propia sección) que espera
// sanitizeLayoutConfig -- si una sección o un elemento no trae un box válido,
// se descarta acá en vez de dejar pasar coordenadas basura.
function resolvePreciseSectionBoxes(rawSections: unknown): unknown[] {
  if (!Array.isArray(rawSections)) return [];
  return rawSections
    .map((rawSection) => {
      if (!rawSection || typeof rawSection !== "object") return null;
      const section = { ...(rawSection as Record<string, unknown>) };
      const sectionBox = section.box;
      if (!isRawBox(sectionBox)) return null;
      const [sy0, sx0, sy1, sx1] = sectionBox;
      const sectionHeight = Math.max(sy1 - sy0, 1);
      section.heightVh = Math.round((sectionHeight / 1000) * 100);

      const rawElements = Array.isArray(section.elements) ? section.elements : [];
      const sectionWidth = Math.max(sx1 - sx0, 1);
      section.elements = rawElements
        .map((rawElement) => {
          if (!rawElement || typeof rawElement !== "object") return null;
          const element = { ...(rawElement as Record<string, unknown>) };
          const elementBox = element.box;
          if (!isRawBox(elementBox)) return null;
          const [ey0, ex0, ey1, ex1] = elementBox;
          element.x = Math.round(((ex0 - sx0) / sectionWidth) * 100);
          element.y = Math.round(((ey0 - sy0) / sectionHeight) * 100);
          element.w = Math.round(((ex1 - ex0) / sectionWidth) * 100);
          delete element.box;
          return element;
        })
        .filter((element) => element !== null);
      delete section.box;
      return section;
    })
    .filter((section) => section !== null);
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
    "Sos un extractor de geometría visual para CLOUVA, especializado en detección espacial de elementos de UI en una imagen.",
    "Tu tarea es analizar un mockup/screenshot real de una web y devolver el cuadro delimitador EXACTO de cada bloque y cada elemento visible dentro de él, para que un renderer pueda reconstruir esa página lo más fiel posible al mockup -- no una aproximación con plantillas, una réplica.",
    "Vos NUNCA generás HTML, CSS ni JSX -- solo números y valores de un vocabulario cerrado.",
    "",
    `Las imágenes en los índices ${JSON.stringify(relevantIndexes)} son el mockup real a replicar.`,
    `Datos confirmados del ${args.subjectLabel} (único material permitido para el copy -- nunca inventes texto que no esté acá ni copies nombres/marcas ajenas que aparezcan en el mockup): ${JSON.stringify(args.facts)}`,
    `Copy ya aprobado (usalo tal cual donde corresponda, no lo reescribas): tagline=${JSON.stringify(args.copy.tagline)}, bio=${JSON.stringify(args.copy.short_bio)}`,
    "",
    "FORMATO DE CAJA (\"box\"): SIEMPRE un array de 4 números [ymin, xmin, ymax, xmax], normalizados de 0 a 1000 sobre la imagen COMPLETA (0,0 es la esquina superior izquierda de la imagen entera; 1000,1000 la esquina inferior derecha) -- el mismo formato que usás para detección de objetos. CADA elemento tiene que tener su propia caja realista y distinta -- dos elementos distintos (un título y un botón, por ejemplo) NUNCA pueden compartir la misma caja ni tener valores idénticos entre sí.",
    "",
    `SECCIONES PERMITIDAS ("type"): ${LAYOUT_SECTION_TYPES.join(", ")}. Identificá cada bloque visual grande del mockup (hero, sobre, pilares, galería, roster, servicios, membresía, música, contacto) de arriba hacia abajo, en el orden real en que aparecen, y dale a cada uno su "box" (la región completa que ocupa ese bloque en la imagen).`,
    "",
    "Por cada sección devolvé:",
    '- "box": la caja de toda la sección, como se explicó arriba.',
    `- "background": opcional -- { "color": hex de 6 dígitos si el fondo es un color sólido, "imageSlot": uno de ${IMAGE_SLOTS.join(", ")} si el fondo es una FOTO (nunca una URL). "cover" es la foto principal del hero, "logo" es el ícono/marca chica, "pillar-0"/"pillar-1"/"pillar-2"/"pillar-3" son las fotos de fondo de cada tarjeta de pilares en el orden en que aparecen. Si la sección no tiene foto de fondo, omitilo.`,
    "",
    `Para secciones "estáticas" (hero, about, pillars, contact -- las que muestran texto/botones fijos, no una lista de datos reales) incluí "elements": un array con cada texto/botón/ícono visible DENTRO de esa sección, cada uno con:`,
    `  - "type": uno de ${POSITIONED_ELEMENT_TYPES.join(", ")}.`,
    '  - "text": el contenido real (para pillars, generá 2-4 elementos "heading"+"paragraph" por tarjeta, basados en servicios/valores reales del Estudio -- nunca inventados de la nada). Omitilo para type "image".',
    '  - "box": la caja de ESE elemento puntual (no de toda la sección), mismo formato [ymin,xmin,ymax,xmax] 0-1000 sobre la imagen completa -- tiene que caer DENTRO de la caja de su sección.',
    '  - "fontSizePx": tamaño de fuente estimado en píxeles (10-96) -- solo para heading/subheading/paragraph/badge/button.',
    `  - "fontWeight": el más parecido de ${FONT_WEIGHTS.join(", ")}.`,
    '  - "color": color de texto estimado, hex de 6 dígitos.',
    `  - "align": uno de ${TEXT_ALIGNS.join(", ")}.`,
    `  - Para type "button": "action", clasificando qué hace ese botón según el mockup -- SOLO uno de: "join" (unirse/inscribirse), "share" (compartir), o "scroll:<tipo de sección>" con <tipo de sección> siendo una de ${LAYOUT_SECTION_TYPES.join(", ")} (ej. "scroll:music" si el botón lleva a la música). NUNCA un link/URL -- el destino real siempre lo resuelve el renderer, no vos.`,
    '  - Para type "image": "imageSlot" (mismo vocabulario que el background de arriba) -- nunca text.',
    "",
    `Para secciones "dinámicas" (roster, services, membership, gallery, music -- las que en el sitio real muestran datos reales cuya cantidad no podés saber de antemano) NO incluyas "elements" -- incluí en cambio "styleHint": { "heading": el título de esa sección tal como aparece en el mockup, "cardStyle": uno de ${CARD_STYLES.join(", ")} según cómo se ven las tarjetas en el mockup }.`,
    "",
    "Mismas reglas de siempre para el resto del esquema: \"nav_style\" (bar|pill), \"radius\" (none|small|medium|large), \"page_style.palette\" con hex de 6 dígitos coherentes entre sí, \"nav_items\" y \"footer\" opcionales apuntando a secciones incluidas.",
    "",
    "Devolvé exactamente este JSON, sin texto alrededor:",
    "{",
    '  "mode": "reference_layout",',
    '  "layout_kind": "precise",',
    '  "precise_sections": [ { "type": string, "box": [number, number, number, number], "background": {"color": string, "imageSlot": string}, "elements": [ { "type": string, "text": string, "box": [number, number, number, number], "fontSizePx": number, "fontWeight": number, "color": string, "align": string, "action": string, "imageSlot": string } ], "styleHint": { "heading": string, "cardStyle": string } } ],',
    '  "page_style": { "theme": "dark" | "light" | "mixed", "radius": string, "nav_style": "bar" | "pill", "palette": { "background": string, "surface": string, "text": string, "muted_text": string, "accent": string, "border": string } },',
    '  "nav_items": [ { "label": string, "section": string } ],',
    '  "footer": { "heading": string, "cta_label": string, "cta_section": string } | null',
    "}",
    "(Cada sección solo lleva \"elements\" O \"styleHint\", nunca ambos ni ninguno.)",
  ].join("\n");

  const { parsed, costUsd } = await callGeminiJson({ apiKey: args.apiKey, promptText, images: args.images });
  const resolved = parsed && typeof parsed === "object"
    ? { ...(parsed as Record<string, unknown>), precise_sections: resolvePreciseSectionBoxes((parsed as Record<string, unknown>).precise_sections) }
    : parsed;
  return { layout: sanitizeLayoutConfig(resolved), costUsd };
}

// Solo para modo adaptive_layout (sin mockup web detectado): en vez de un
// único resultado, 3 composiciones distintas entre sí -- cada una recibe
// después su propia portada+logo (decisión del usuario: más variedad real
// en vez de compartir una sola imagen entre las 3). Un solo call de texto
// barato, no tres -- las imágenes recién se generan una vez elegido el
// layout de cada variante.
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
    "Tu tarea es proponer 3 composiciones de página DISTINTAS entre sí (layout_config), a partir de los datos del " + args.subjectLabel + " y, si hay, imágenes de referencia (fotos/branding/moodboards -- no son mockups de web, son solo inspiración estética). Nunca generás HTML, CSS ni JSX, solo datos.",
    "",
    `Resumen del análisis previo: ${args.analysis.summary ?? "(sin resumen)"}`,
    `Datos confirmados del ${args.subjectLabel}: ${JSON.stringify(args.facts)}`,
    `Copy ya aprobado (usalo tal cual para hero/about en las 3, no lo reescribas distinto por variante): tagline=${JSON.stringify(args.copy.tagline)}, bio=${JSON.stringify(args.copy.short_bio)}`,
    "",
    "Las 3 variantes tienen que diferir de verdad entre sí -- no repitas la misma variante de hero en las 3, no repitas la misma paleta, no repitas el mismo orden/selección de secciones. Pensalas como 3 propuestas de diseño reales entre las que alguien tiene que poder elegir con criterio (ej. una más minimalista, una más editorial/inmersiva, una más audaz/experimental) -- pero las tres tienen que quedar bien, ninguna es un relleno.",
    "",
    "SECCIONES PERMITIDAS (\"type\"): hero, about, pillars, gallery, roster, services, membership, music, contact.",
    "VARIANTES POR SECCIÓN:",
    "- hero: centered | split | editorial | full-bleed | overlay",
    "- about: simple | editorial | image-left | image-right",
    "- pillars: 3-cards | 4-cards | icon-grid",
    "- gallery: grid | masonry | strip | collage-clean",
    "- roster: cards | spotlight | list | grid",
    "- services: cards | pricing-grid | editorial-list | compact-grid",
    "- membership: cards | comparison-table | stacked",
    "- music: releases-grid | featured-release | list (alimentada por lanzamientos reales del Estudio, nunca inventes URLs)",
    "- contact: cta | two-column | contact-cards",
    "",
    "Mismas reglas que siempre: incluí \"hero\" primero en cada variante; su \"headline\" tiene que ser una frase completa y autosuficiente (nunca cortada a mitad de frase esperando que subheadline la termine); el hero puede llevar \"primaryLabel\"/\"secondaryLabel\" (texto corto de hasta 2 botones) y opcionalmente \"primaryIcon\"/\"secondaryIcon\" (solo uno de: sparkles, play, users, music, heart, arrow-right, mic, calendar, headphones, star); \"pillars\" con 2-4 items reales (nunca inventados, cada uno puede llevar opcionalmente \"icon\" del mismo catálogo cerrado que primaryIcon/secondaryIcon); no más de 9 secciones por variante; colores hex de 6 dígitos coherentes entre sí; \"nav_style\" (bar|pill) y \"radius\" (none|small|medium|large) también pueden variar entre las 3.",
    "",
    "Devolvé exactamente este JSON, sin texto alrededor:",
    "{",
    '  "variants": [',
    '    { "sections": [ { "type": string, "variant": string, "headline": string, "subheadline": string, "primaryLabel": string, "primaryIcon": string, "secondaryLabel": string, "secondaryIcon": string, "heading": string, "body": string, "items": [{"title": string, "description": string, "icon": string}] } ], "page_style": { "theme": "dark" | "light" | "mixed", "radius": string, "nav_style": "bar" | "pill", "palette": { "background": string, "surface": string, "text": string, "muted_text": string, "accent": string, "border": string } }, "nav_items": [ { "label": string, "section": string } ] },',
    '    { "...segunda variante, misma forma..." },',
    '    { "...tercera variante, misma forma..." }',
    "  ]",
    "}",
  ].join("\n");

  const { parsed, costUsd } = await callGeminiJson({ apiKey: args.apiKey, promptText, images: args.images });
  const rawVariants = parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).variants)
    ? (parsed as Record<string, unknown>).variants as unknown[]
    : [];
  const layouts = rawVariants
    .map((variant) => sanitizeLayoutConfig({ ...(variant as Record<string, unknown>), mode: "adaptive_layout" }))
    .filter((layout): layout is LayoutConfig => layout !== null)
    .slice(0, 3);

  return { layouts, costUsd };
}
