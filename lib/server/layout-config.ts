// Esquema fijo de "página custom" generada por CLOUVA AI Profile -- Gemini
// nunca produce HTML/JSX, solo esta estructura JSON (guardada en
// player_profile_versions.layout_config), interpretada por un renderer React
// fijo (components/public/StudioLayoutRenderer.tsx). Deliberadamente NO
// incluye URLs de imagen que Gemini pueda inventar: las imágenes reales
// (portada/logo/galería) siguen viniendo de asset_references/los datos del
// Estudio ya existentes, nunca del JSON que Gemini devuelve -- así
// layout_config solo puede describir texto, modo, variante de sección y
// color de ese lado. La única excepción es `PillarItem.image`: esa URL nunca
// la propone Gemini (no forma parte de lo que se le pide en el prompt), la
// escribe nuestro propio servidor después de generar una foto real por
// pillar -- igual se valida como URL https bien formada al sanitizar, nunca
// se confía en el string a ciegas.
//
// `mode` distingue las dos formas en que se llega a este layout:
// - "reference_layout": el usuario subió una o más imágenes que son mockups/
//   referencias de una web real, y este layout intenta reconstruirlas fiel.
// - "adaptive_layout": no había mockup claro (fotos del estudio, moodboard,
//   branding, o directamente nada) -- este layout es una composición
//   original armada a partir de esas referencias más los datos del Estudio.

export const LAYOUT_SECTION_TYPES = [
  "hero",
  "about",
  "pillars",
  "gallery",
  "roster",
  "services",
  "membership",
  "music",
  "contact",
] as const;

export type LayoutSectionType = (typeof LAYOUT_SECTION_TYPES)[number];

export const LAYOUT_MODES = ["reference_layout", "adaptive_layout"] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];

// Catálogo fijo de variantes por tipo de sección. El renderer no tiene por
// qué diferenciar visualmente cada una desde el día uno -- las que todavía
// no tienen un tratamiento propio caen al default (primera de la lista) sin
// romper nada -- pero el esquema ya las acepta todas para no tener que migrar
// datos cuando se sumen.
export const SECTION_VARIANTS = {
  hero: ["centered", "split", "editorial", "full-bleed", "overlay"],
  about: ["simple", "editorial", "image-left", "image-right"],
  pillars: ["3-cards", "4-cards", "icon-grid"],
  gallery: ["grid", "masonry", "strip", "collage-clean"],
  roster: ["cards", "spotlight", "list", "grid"],
  services: ["cards", "pricing-grid", "editorial-list", "compact-grid"],
  membership: ["cards", "comparison-table", "stacked"],
  music: ["releases-grid", "featured-release", "list"],
  contact: ["cta", "two-column", "contact-cards"],
} as const satisfies Record<LayoutSectionType, readonly string[]>;

export type SectionVariant<T extends LayoutSectionType> = (typeof SECTION_VARIANTS)[T][number];

// Catálogo cerrado de íconos para los botones del hero y los pillars -- nunca
// un nombre arbitrario de ícono, siempre uno de estos (mapeados a
// lucide-react en el renderer).
export const LAYOUT_ICONS = ["sparkles", "play", "users", "music", "heart", "arrow-right", "mic", "calendar", "headphones", "star"] as const;
export type LayoutIconName = (typeof LAYOUT_ICONS)[number];

export type HeroSection = {
  type: "hero";
  variant: SectionVariant<"hero">;
  headline: string;
  subheadline?: string | null;
  primaryLabel?: string | null;
  primaryIcon?: LayoutIconName | null;
  secondaryLabel?: string | null;
  secondaryIcon?: LayoutIconName | null;
};

export type AboutSection = {
  type: "about";
  variant: SectionVariant<"about">;
  heading: string;
  body: string;
};

export type PillarItem = { title: string; description: string; image?: string | null; icon?: LayoutIconName | null };

export type PillarsSection = {
  type: "pillars";
  variant: SectionVariant<"pillars">;
  heading: string;
  items: PillarItem[];
};

export type GallerySection = { type: "gallery"; variant: SectionVariant<"gallery">; heading?: string | null };
export type RosterSection = { type: "roster"; variant: SectionVariant<"roster">; heading?: string | null };
export type ServicesSection = { type: "services"; variant: SectionVariant<"services">; heading?: string | null };
export type MembershipSection = { type: "membership"; variant: SectionVariant<"membership">; heading?: string | null };
export type ContactSection = { type: "contact"; variant: SectionVariant<"contact">; heading?: string | null };

// "Música y lanzamientos" -- deliberadamente sin URLs propias en el JSON.
// El renderer alimenta esta sección con community_projects (datos reales ya
// cargados por el Estudio, con sus propios spotify_url/youtube_url), nunca
// con un embed que la IA haya inventado -- más simple y sin superficie para
// que Gemini proponga una URL arbitraria.
export type MusicSection = {
  type: "music";
  variant: SectionVariant<"music">;
  heading?: string | null;
};

export type LayoutSection =
  | HeroSection
  | AboutSection
  | PillarsSection
  | GallerySection
  | RosterSection
  | ServicesSection
  | MembershipSection
  | MusicSection
  | ContactSection;

// "precise": modo paralelo al de sections/variant de arriba, usado solo para
// reference_layout, cuando Gemini extrae geometría real (posición/tamaño/
// estilo por elemento) de la imagen subida en vez de elegir una variante fija
// -- el objetivo es replicar el mockup lo más fiel posible, no aproximarlo.
// Sigue siendo 100% datos estructurados y sanitizados acá abajo (números
// clamped, enums cerrados) -- Gemini nunca produce HTML/CSS/JSX, ni acá ni en
// el modo viejo.
export const LAYOUT_KINDS = ["template", "precise"] as const;
export type LayoutKind = (typeof LAYOUT_KINDS)[number];

export const IMAGE_SLOTS = ["cover", "logo", "pillar-0", "pillar-1", "pillar-2", "pillar-3"] as const;
export type ImageSlot = (typeof IMAGE_SLOTS)[number];

// El destino real de un botón nunca lo decide Gemini (sería una superficie
// para href arbitrarios) -- solo clasifica CUÁL de estas acciones reales es
// la más probable dado lo que muestra el mockup; el renderer resuelve cada
// una a la lógica real de siempre (join/roster/anchors), igual que ya hace
// hoy con primaryAction/secondaryAction del hero clásico.
export type RealAction = "join" | "share" | `scroll:${LayoutSectionType}`;

export const POSITIONED_ELEMENT_TYPES = ["eyebrow", "heading", "subheading", "paragraph", "button", "badge", "image"] as const;
export type PositionedElementType = (typeof POSITIONED_ELEMENT_TYPES)[number];

export const FONT_WEIGHTS = [400, 500, 600, 700, 800, 900] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export const CARD_STYLES = ["bordered", "flat", "image-bg"] as const;
export type CardStyle = (typeof CARD_STYLES)[number];

// Cada variante es una combinación de clases YA diseñada por nosotros
// (gradient/glow usan page_style.palette.accent, que ya es un hex validado)
// -- Gemini solo elige cuál se parece más al botón del mockup, nunca describe
// el estilo libremente.
export const BUTTON_STYLES = ["solid", "outline", "gradient", "glow"] as const;
export type ButtonStyle = (typeof BUTTON_STYLES)[number];

export const IMAGE_FITS = ["cover", "contain"] as const;
export type ImageFit = (typeof IMAGE_FITS)[number];

export const IMAGE_POSITIONS = ["center", "top", "bottom", "left", "right"] as const;
export type ImagePosition = (typeof IMAGE_POSITIONS)[number];

// Elementos decorativos puramente visuales -- cada tipo lo dibujamos nosotros
// (SVG/CSS fijo en el renderer), Gemini solo elige cuáles usar y dónde
// posicionarlos. Nunca un SVG o markup libre generado por la IA.
export const DECORATION_TYPES = ["waveform", "scroll-indicator", "vertical-label", "divider-line"] as const;
export type DecorationType = (typeof DECORATION_TYPES)[number];

export type Decoration = {
  type: DecorationType;
  x: number;
  y: number;
  w?: number | null;
  text?: string | null;
};

// x/y/w son porcentajes (0-100) relativos a la sección que los contiene, no
// a la página entera -- así el renderer puede posicionar con `style={{ left,
// top, width }}` sin depender de un ancho de pantalla fijo.
export type PositionedElement = {
  type: PositionedElementType;
  text?: string | null;
  x: number;
  y: number;
  w: number;
  fontSizePx?: number | null;
  fontWeight?: FontWeight | null;
  color?: string | null;
  align?: TextAlign | null;
  action?: RealAction | null;
  imageSlot?: ImageSlot | null;
  icon?: LayoutIconName | null;
  buttonStyle?: ButtonStyle | null;
};

export type PreciseSectionStyleHint = {
  heading?: string | null;
  cardStyle?: CardStyle | null;
};

// Las secciones con datos reales de longitud variable (roster/services/
// membership/gallery/music) no llevan `elements` posicionados uno por uno --
// Gemini no puede saber cuántos Players/servicios reales hay -- llevan
// `styleHint` en cambio, y el renderer sigue usando el componente real de
// siempre (grid de Players, StudioServicesCart, etc.) pero con el
// accent/heading/estilo de tarjeta extraídos del mockup.
//
// `columns`: cuando el mockup combina varios bloques en una sola composición
// horizontal (ej. "about" + pilares + reproductor lado a lado), la sección
// se pinta como fila en vez de bloque único -- cada columna es una
// mini-sección normal (mismo tipo, un solo nivel de anidamiento: una columna
// nunca puede tener sus propias `columns`, se ignora si Gemini lo intenta).
export type PreciseSection = {
  type: LayoutSectionType;
  heightVh: number;
  widthPct?: number | null;
  background?: { color?: string | null; imageSlot?: ImageSlot | null; fit?: ImageFit | null; position?: ImagePosition | null } | null;
  elements?: PositionedElement[];
  styleHint?: PreciseSectionStyleHint | null;
  decorations?: Decoration[];
  columns?: PreciseSection[];
};

export type PagePalette = {
  background?: string;
  surface?: string;
  text?: string;
  muted_text?: string;
  accent?: string;
  border?: string;
};

export const RADIUS_VALUES = ["none", "small", "medium", "large"] as const;
export type RadiusValue = (typeof RADIUS_VALUES)[number];

export const NAV_STYLES = ["pill", "bar"] as const;
export type NavStyle = (typeof NAV_STYLES)[number];

export type PageStyle = {
  theme?: "dark" | "light" | "mixed";
  palette?: PagePalette | null;
  radius?: RadiusValue;
  nav_style?: NavStyle;
  // Solo tiene efecto en layout_kind "precise" -- el modo "template" nunca lo
  // lee, así que no cambia nada de lo ya publicado.
  header_overlay?: boolean;
};

export type LayoutNavItem = { label: string; section: LayoutSectionType };

export type LayoutFooter = { heading: string; cta_label: string; cta_section: LayoutSectionType };

// Resuelve cada ImageSlot a su URL real -- lo escribe nuestro propio server
// después de generar/ubicar cada asset (cover_url/logo_url del Estudio,
// fotos de pillar generadas), nunca Gemini. Mismo principio que
// PillarItem.image en el esquema viejo: se re-sanitiza como URL https en
// cada lectura, nunca se confía en el string a ciegas.
export type ImageSlotMap = Partial<Record<ImageSlot, string>>;

export type LayoutConfig = {
  mode: LayoutMode;
  layout_kind: LayoutKind;
  sections: LayoutSection[];
  precise_sections: PreciseSection[];
  image_slots: ImageSlotMap;
  page_style?: PageStyle | null;
  nav_items?: LayoutNavItem[] | null;
  footer?: LayoutFooter | null;
};

const MAX_SECTIONS = 9;
const MAX_PILLAR_ITEMS = 4;
const MAX_NAV_ITEMS = 6;
const MAX_ELEMENTS_PER_SECTION = 12;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function text(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function optionalText(value: unknown, maxLength: number): string | null {
  const cleaned = text(value, maxLength);
  return cleaned || null;
}

function sanitizeVariant<T extends LayoutSectionType>(type: T, raw: unknown): SectionVariant<T> {
  const allowed = SECTION_VARIANTS[type] as readonly string[];
  return (typeof raw === "string" && allowed.includes(raw) ? raw : allowed[0]) as SectionVariant<T>;
}

function sanitizeLayoutIcon(raw: unknown): LayoutIconName | null {
  return typeof raw === "string" && (LAYOUT_ICONS as readonly string[]).includes(raw) ? (raw as LayoutIconName) : null;
}

// Solo para PillarItem.image -- ese campo lo escribe nuestro propio server
// (nunca Gemini), pero igual se re-sanitiza en cada request (ver
// sanitizeLayoutConfig), así que valida que sea una URL https bien formada
// antes de dejarla pasar, nunca confía en el string a ciegas.
function httpsUrlOrNull(value: unknown, maxLength: number): string | null {
  const cleaned = text(value, maxLength);
  if (!cleaned) return null;
  try {
    return new URL(cleaned).protocol === "https:" ? cleaned : null;
  } catch {
    return null;
  }
}

function sanitizeSection(raw: unknown): LayoutSection | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const type = value.type;

  switch (type) {
    case "hero": {
      const headline = text(value.headline, 120);
      if (!headline) return null;
      return {
        type: "hero",
        variant: sanitizeVariant("hero", value.variant),
        headline,
        subheadline: optionalText(value.subheadline, 200),
        primaryLabel: optionalText(value.primaryLabel, 40),
        primaryIcon: sanitizeLayoutIcon(value.primaryIcon),
        secondaryLabel: optionalText(value.secondaryLabel, 40),
        secondaryIcon: sanitizeLayoutIcon(value.secondaryIcon),
      };
    }
    case "about": {
      const heading = text(value.heading, 60) || "Sobre nosotros";
      const body = text(value.body, 1200);
      if (!body) return null;
      return { type: "about", variant: sanitizeVariant("about", value.variant), heading, body };
    }
    case "pillars": {
      const heading = text(value.heading, 60) || "Nuestros pilares";
      const items = Array.isArray(value.items)
        ? value.items
            .map((item): PillarItem | null => {
              if (!item || typeof item !== "object") return null;
              const title = text((item as Record<string, unknown>).title, 60);
              const description = text((item as Record<string, unknown>).description, 240);
              const image = httpsUrlOrNull((item as Record<string, unknown>).image, 500);
              const icon = sanitizeLayoutIcon((item as Record<string, unknown>).icon);
              return title && description ? { title, description, image, icon } : null;
            })
            .filter((item): item is PillarItem => item !== null)
            .slice(0, MAX_PILLAR_ITEMS)
        : [];
      if (items.length < 2) return null;
      return { type: "pillars", variant: sanitizeVariant("pillars", value.variant), heading, items };
    }
    case "gallery":
      return { type: "gallery", variant: sanitizeVariant("gallery", value.variant), heading: optionalText(value.heading, 60) };
    case "roster":
      return { type: "roster", variant: sanitizeVariant("roster", value.variant), heading: optionalText(value.heading, 60) };
    case "services":
      return { type: "services", variant: sanitizeVariant("services", value.variant), heading: optionalText(value.heading, 60) };
    case "membership":
      return { type: "membership", variant: sanitizeVariant("membership", value.variant), heading: optionalText(value.heading, 60) };
    case "contact":
      return { type: "contact", variant: sanitizeVariant("contact", value.variant), heading: optionalText(value.heading, 60) };
    case "music":
      return { type: "music", variant: sanitizeVariant("music", value.variant), heading: optionalText(value.heading, 60) };
    default:
      return null;
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, num));
}

function optionalClampNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null;
}

function hexColorOrNull(value: unknown): string | null {
  return typeof value === "string" && HEX_COLOR_RE.test(value) ? value : null;
}

function sanitizeImageSlot(raw: unknown): ImageSlot | null {
  return typeof raw === "string" && (IMAGE_SLOTS as readonly string[]).includes(raw) ? (raw as ImageSlot) : null;
}

const SCROLL_ACTIONS = new Set<string>(LAYOUT_SECTION_TYPES.map((type) => `scroll:${type}`));

function sanitizeRealAction(raw: unknown): RealAction | null {
  if (raw === "join" || raw === "share") return raw;
  return typeof raw === "string" && SCROLL_ACTIONS.has(raw) ? (raw as RealAction) : null;
}

function sanitizeFontWeight(raw: unknown): FontWeight | null {
  return typeof raw === "number" && (FONT_WEIGHTS as readonly number[]).includes(raw) ? (raw as FontWeight) : null;
}

function sanitizeTextAlign(raw: unknown): TextAlign | null {
  return typeof raw === "string" && (TEXT_ALIGNS as readonly string[]).includes(raw) ? (raw as TextAlign) : null;
}

function sanitizeCardStyle(raw: unknown): CardStyle | null {
  return typeof raw === "string" && (CARD_STYLES as readonly string[]).includes(raw) ? (raw as CardStyle) : null;
}

function sanitizeButtonStyle(raw: unknown): ButtonStyle | null {
  return typeof raw === "string" && (BUTTON_STYLES as readonly string[]).includes(raw) ? (raw as ButtonStyle) : null;
}

function sanitizeImageFit(raw: unknown): ImageFit | null {
  return typeof raw === "string" && (IMAGE_FITS as readonly string[]).includes(raw) ? (raw as ImageFit) : null;
}

function sanitizeImagePosition(raw: unknown): ImagePosition | null {
  return typeof raw === "string" && (IMAGE_POSITIONS as readonly string[]).includes(raw) ? (raw as ImagePosition) : null;
}

function sanitizeDecorationType(raw: unknown): DecorationType | null {
  return typeof raw === "string" && (DECORATION_TYPES as readonly string[]).includes(raw) ? (raw as DecorationType) : null;
}

function sanitizeDecoration(raw: unknown): Decoration | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const type = sanitizeDecorationType(value.type);
  if (!type) return null;
  const x = optionalClampNumber(value.x, 0, 100);
  const y = optionalClampNumber(value.y, 0, 100);
  if (x === null || y === null) return null;
  return {
    type,
    x,
    y,
    w: optionalClampNumber(value.w, 1, 100),
    text: type === "vertical-label" ? optionalText(value.text, 60) : null,
  };
}

function sanitizePositionedElement(raw: unknown): PositionedElement | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const type = typeof value.type === "string" && (POSITIONED_ELEMENT_TYPES as readonly string[]).includes(value.type)
    ? (value.type as PositionedElementType)
    : null;
  if (!type) return null;
  const rawX = optionalClampNumber(value.x, 0, 100);
  const rawY = optionalClampNumber(value.y, 0, 100);
  const w = optionalClampNumber(value.w, 1, 100);
  if (rawX === null || rawY === null || w === null) return null;
  // Defensivo, más allá de qué tan bien Gemini haya estimado las cajas: un
  // elemento nunca puede quedar posicionado de forma que se salga de su
  // sección -- se corrige la esquina en vez de dejarlo desbordar la pantalla.
  const x = Math.min(rawX, 100 - w);
  const y = Math.min(rawY, 92);
  return {
    type,
    text: optionalText(value.text, type === "paragraph" ? 600 : 120),
    x,
    y,
    w,
    fontSizePx: optionalClampNumber(value.fontSizePx, 10, 96),
    fontWeight: sanitizeFontWeight(value.fontWeight),
    color: hexColorOrNull(value.color),
    align: sanitizeTextAlign(value.align),
    action: type === "button" ? sanitizeRealAction(value.action) : null,
    imageSlot: type === "image" ? sanitizeImageSlot(value.imageSlot) : null,
    icon: type === "button" ? sanitizeLayoutIcon(value.icon) : null,
    buttonStyle: type === "button" ? sanitizeButtonStyle(value.buttonStyle) : null,
  };
}

const MAX_COLUMNS = 4;

// `allowColumns` evita más de un nivel de anidamiento -- una columna nunca
// puede tener sus propias columnas, se ignora silenciosamente si Gemini lo
// intenta (en vez de fallar toda la sección).
function sanitizePreciseSection(raw: unknown, allowColumns = true): PreciseSection | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const type = typeof value.type === "string" && (LAYOUT_SECTION_TYPES as readonly string[]).includes(value.type)
    ? (value.type as LayoutSectionType)
    : null;
  if (!type) return null;
  const heightVh = clampNumber(value.heightVh, 20, 150, 60);
  const widthPct = optionalClampNumber(value.widthPct, 5, 100);

  const rawBackground = value.background && typeof value.background === "object" ? (value.background as Record<string, unknown>) : null;
  const background = rawBackground
    ? {
        color: hexColorOrNull(rawBackground.color),
        imageSlot: sanitizeImageSlot(rawBackground.imageSlot),
        fit: sanitizeImageFit(rawBackground.fit),
        position: sanitizeImagePosition(rawBackground.position),
      }
    : null;

  const elements = Array.isArray(value.elements)
    ? value.elements.map(sanitizePositionedElement).filter((element): element is PositionedElement => element !== null).slice(0, MAX_ELEMENTS_PER_SECTION)
    : [];

  const rawStyleHint = value.styleHint && typeof value.styleHint === "object" ? (value.styleHint as Record<string, unknown>) : null;
  const styleHint = rawStyleHint
    ? { heading: optionalText(rawStyleHint.heading, 60), cardStyle: sanitizeCardStyle(rawStyleHint.cardStyle) }
    : null;

  const decorations = Array.isArray(value.decorations)
    ? value.decorations.map(sanitizeDecoration).filter((decoration): decoration is Decoration => decoration !== null).slice(0, MAX_ELEMENTS_PER_SECTION)
    : [];

  const columns = allowColumns && Array.isArray(value.columns)
    ? value.columns
        .map((column) => sanitizePreciseSection(column, false))
        .filter((column): column is PreciseSection => column !== null)
        .slice(0, MAX_COLUMNS)
    : [];

  // Una sección sin ningún elemento posicionado, sin styleHint y sin columnas
  // no aporta nada -- se descarta en vez de dejar un bloque vacío en la
  // página.
  if (elements.length === 0 && !styleHint && columns.length === 0) return null;

  return { type, heightVh, widthPct, background, elements, styleHint, decorations, columns };
}

function sanitizeImageSlotMap(raw: unknown): ImageSlotMap {
  if (!raw || typeof raw !== "object") return {};
  const value = raw as Record<string, unknown>;
  const map: ImageSlotMap = {};
  for (const slot of IMAGE_SLOTS) {
    const url = httpsUrlOrNull(value[slot], 500);
    if (url) map[slot] = url;
  }
  return map;
}

function sanitizePalette(raw: unknown): PagePalette | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const palette: PagePalette = {};
  (["background", "surface", "text", "muted_text", "accent", "border"] as const).forEach((key) => {
    const candidate = value[key];
    if (typeof candidate === "string" && HEX_COLOR_RE.test(candidate)) palette[key] = candidate;
  });
  return Object.keys(palette).length > 0 ? palette : null;
}

function sanitizePageStyle(raw: unknown): PageStyle | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const theme = value.theme === "dark" || value.theme === "light" || value.theme === "mixed" ? value.theme : undefined;
  const palette = sanitizePalette(value.palette);
  const radius = typeof value.radius === "string" && RADIUS_VALUES.includes(value.radius as RadiusValue) ? (value.radius as RadiusValue) : undefined;
  const navStyle = typeof value.nav_style === "string" && NAV_STYLES.includes(value.nav_style as NavStyle) ? (value.nav_style as NavStyle) : undefined;
  const headerOverlay = value.header_overlay === true;
  if (!theme && !palette && !radius && !navStyle && !headerOverlay) return null;
  return { theme, palette, radius, nav_style: navStyle, header_overlay: headerOverlay };
}

function sanitizeFooter(raw: unknown, validSections: Set<LayoutSectionType>): LayoutFooter | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const heading = text(value.heading, 80);
  const ctaLabel = text(value.cta_label, 40);
  const ctaSection = value.cta_section;
  if (!heading || !ctaLabel || typeof ctaSection !== "string" || !validSections.has(ctaSection as LayoutSectionType)) return null;
  return { heading, cta_label: ctaLabel, cta_section: ctaSection as LayoutSectionType };
}

function sanitizeNavItems(raw: unknown, validSections: Set<LayoutSectionType>): LayoutNavItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items = raw
    .map((item): LayoutNavItem | null => {
      if (!item || typeof item !== "object") return null;
      const label = text((item as Record<string, unknown>).label, 24);
      const section = (item as Record<string, unknown>).section;
      if (!label || typeof section !== "string" || !validSections.has(section as LayoutSectionType)) return null;
      return { label, section: section as LayoutSectionType };
    })
    .filter((item): item is LayoutNavItem => item !== null)
    .slice(0, MAX_NAV_ITEMS);
  return items.length > 0 ? items : null;
}

// Nunca confía ciegamente en lo que viene de la base (podría ser legacy/
// corrupto) ni en lo que devuelve Gemini -- todo campo se revalida acá antes
// de llegar al renderer. Devuelve null si no queda ninguna sección válida
// (el caller debe caer al template fijo existente en ese caso).
export function sanitizeLayoutConfig(raw: unknown): LayoutConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const mode: LayoutMode = value.mode === "reference_layout" ? "reference_layout" : "adaptive_layout";
  const layoutKind: LayoutKind = value.layout_kind === "precise" ? "precise" : "template";

  const sections = Array.isArray(value.sections)
    ? value.sections.map(sanitizeSection).filter((section): section is LayoutSection => section !== null).slice(0, MAX_SECTIONS)
    : [];
  const preciseSections = Array.isArray(value.precise_sections)
    ? value.precise_sections.map((section) => sanitizePreciseSection(section)).filter((section): section is PreciseSection => section !== null).slice(0, MAX_SECTIONS)
    : [];

  // "precise" y "template" son mutuamente excluyentes -- cada uno valida y
  // requiere solo su propio array de secciones, nunca mezcla ambos esquemas.
  if (layoutKind === "precise") {
    if (preciseSections.length === 0) return null;
  } else if (sections.length === 0) {
    return null;
  }

  const sectionTypes = new Set((layoutKind === "precise" ? preciseSections : sections).map((section) => section.type));

  return {
    mode,
    layout_kind: layoutKind,
    sections,
    precise_sections: preciseSections,
    image_slots: sanitizeImageSlotMap(value.image_slots),
    page_style: sanitizePageStyle(value.page_style),
    nav_items: sanitizeNavItems(value.nav_items, sectionTypes),
    footer: sanitizeFooter(value.footer, sectionTypes),
  };
}
