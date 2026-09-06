// Canonical structured layout contract for CLOUVA public Player/Studio pages.
// Gemini never returns HTML/CSS/JSX. It only returns this closed JSON shape,
// which is sanitized before it reaches the renderer or persistence layer.

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

export const PRECISE_DYNAMIC_SECTION_TYPES = ["roster", "services", "membership", "gallery", "music"] as const;

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
export type MusicSection = { type: "music"; variant: SectionVariant<"music">; heading?: string | null };

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

export const LAYOUT_KINDS = ["template", "precise"] as const;
export type LayoutKind = (typeof LAYOUT_KINDS)[number];

export const IMAGE_SLOTS = ["cover", "logo", "pillar-0", "pillar-1", "pillar-2", "pillar-3"] as const;
export type ImageSlot = (typeof IMAGE_SLOTS)[number];

export type RealAction = "join" | "share" | `scroll:${LayoutSectionType}`;

export const POSITIONED_ELEMENT_TYPES = ["eyebrow", "heading", "subheading", "paragraph", "button", "badge", "image"] as const;
export type PositionedElementType = (typeof POSITIONED_ELEMENT_TYPES)[number];

export const FONT_WEIGHTS = [400, 500, 600, 700, 800, 900] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export const CARD_STYLES = ["bordered", "flat", "image-bg"] as const;
export type CardStyle = (typeof CARD_STYLES)[number];

export const BUTTON_STYLES = ["solid", "outline", "gradient", "glow"] as const;
export type ButtonStyle = (typeof BUTTON_STYLES)[number];

export const IMAGE_FITS = ["cover", "contain"] as const;
export type ImageFit = (typeof IMAGE_FITS)[number];

export const IMAGE_POSITIONS = ["center", "top", "bottom", "left", "right"] as const;
export type ImagePosition = (typeof IMAGE_POSITIONS)[number];

export const SHADOW_PRESETS = ["none", "soft", "medium", "strong", "glow"] as const;
export type ShadowPreset = (typeof SHADOW_PRESETS)[number];

export const BLUR_PRESETS = ["none", "soft", "medium", "strong"] as const;
export type BlurPreset = (typeof BLUR_PRESETS)[number];

export const DECORATION_TYPES = ["waveform", "scroll-indicator", "vertical-label", "divider-line"] as const;
export type DecorationType = (typeof DECORATION_TYPES)[number];

export type MobileElementLayout = {
  hidden?: boolean;
  order?: number | null;
  w?: number | null;
  align?: TextAlign | null;
};

export type Decoration = {
  id?: string | null;
  type: DecorationType;
  x: number;
  y: number;
  w?: number | null;
  h?: number | null;
  zIndex?: number | null;
  opacity?: number | null;
  text?: string | null;
};

// x/y/w/h are percentages relative to the section that contains the element.
// V1 layouts without h remain valid; V2 reference layouts should always carry h.
export type PositionedElement = {
  id?: string | null;
  type: PositionedElementType;
  text?: string | null;
  x: number;
  y: number;
  w: number;
  h?: number | null;
  zIndex?: number | null;
  fontSizePx?: number | null;
  fontWeight?: FontWeight | null;
  color?: string | null;
  align?: TextAlign | null;
  letterSpacingPx?: number | null;
  lineHeight?: number | null;
  opacity?: number | null;
  backgroundColor?: string | null;
  borderColor?: string | null;
  borderWidthPx?: number | null;
  radiusPx?: number | null;
  shadow?: ShadowPreset | null;
  blur?: BlurPreset | null;
  action?: RealAction | null;
  imageSlot?: ImageSlot | null;
  imageFit?: ImageFit | null;
  imagePosition?: ImagePosition | null;
  icon?: LayoutIconName | null;
  buttonStyle?: ButtonStyle | null;
  mobile?: MobileElementLayout | null;
};

export type PreciseSectionStyleHint = {
  heading?: string | null;
  cardStyle?: CardStyle | null;
  columns?: number | null;
  gapPx?: number | null;
  paddingPx?: number | null;
  radiusPx?: number | null;
  borderColor?: string | null;
  backgroundColor?: string | null;
  cardRadiusPx?: number | null;
  cardBorderColor?: string | null;
  cardBackgroundColor?: string | null;
};

export type PreciseSection = {
  id?: string | null;
  type: LayoutSectionType;
  heightVh: number;
  widthPct?: number | null;
  xPct?: number | null;
  background?: {
    color?: string | null;
    imageSlot?: ImageSlot | null;
    fit?: ImageFit | null;
    position?: ImagePosition | null;
    overlayOpacity?: number | null;
  } | null;
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
  header_overlay?: boolean;
};

export type LayoutNavItem = { label: string; section: LayoutSectionType };
export type LayoutFooter = { heading: string; cta_label: string; cta_section: LayoutSectionType };
export type ImageSlotMap = Partial<Record<ImageSlot, string>>;

export type LayoutConfig = {
  // Optional so all existing literal layouts stay source-compatible. The
  // sanitizer marks new precise contracts as V2 while accepting V1 forever.
  schema_version?: 1 | 2;
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
const MAX_PRECISE_ELEMENTS_PER_SECTION = 32;
const MAX_COLUMNS = 4;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const STABLE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

function text(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function optionalText(value: unknown, maxLength: number): string | null {
  const cleaned = text(value, maxLength);
  return cleaned || null;
}

function stableIdOrNull(value: unknown): string | null {
  return typeof value === "string" && STABLE_ID_RE.test(value) ? value : null;
}

function sanitizeVariant<T extends LayoutSectionType>(type: T, raw: unknown): SectionVariant<T> {
  const allowed = SECTION_VARIANTS[type] as readonly string[];
  return (typeof raw === "string" && allowed.includes(raw) ? raw : allowed[0]) as SectionVariant<T>;
}

function sanitizeLayoutIcon(raw: unknown): LayoutIconName | null {
  return typeof raw === "string" && (LAYOUT_ICONS as readonly string[]).includes(raw) ? (raw as LayoutIconName) : null;
}

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
              const row = item as Record<string, unknown>;
              const title = text(row.title, 60);
              const description = text(row.description, 240);
              if (!title || !description) return null;
              return {
                title,
                description,
                image: httpsUrlOrNull(row.image, 500),
                icon: sanitizeLayoutIcon(row.icon),
              };
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

function sanitizeShadow(raw: unknown): ShadowPreset | null {
  return typeof raw === "string" && (SHADOW_PRESETS as readonly string[]).includes(raw) ? (raw as ShadowPreset) : null;
}

function sanitizeBlur(raw: unknown): BlurPreset | null {
  return typeof raw === "string" && (BLUR_PRESETS as readonly string[]).includes(raw) ? (raw as BlurPreset) : null;
}

function sanitizeDecorationType(raw: unknown): DecorationType | null {
  return typeof raw === "string" && (DECORATION_TYPES as readonly string[]).includes(raw) ? (raw as DecorationType) : null;
}

function sanitizeMobileLayout(raw: unknown): MobileElementLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const mobile: MobileElementLayout = {
    hidden: value.hidden === true,
    order: optionalClampNumber(value.order, -20, 100),
    w: optionalClampNumber(value.w, 10, 100),
    align: sanitizeTextAlign(value.align),
  };
  return mobile.hidden || mobile.order !== null || mobile.w !== null || mobile.align !== null ? mobile : null;
}

function sanitizeDecoration(raw: unknown): Decoration | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const type = sanitizeDecorationType(value.type);
  if (!type) return null;
  const rawX = optionalClampNumber(value.x, 0, 100);
  const rawY = optionalClampNumber(value.y, 0, 100);
  if (rawX === null || rawY === null) return null;
  const w = optionalClampNumber(value.w, 0.5, 100);
  const h = optionalClampNumber(value.h, 0.5, 100);
  const x = w === null ? rawX : Math.min(rawX, 100 - w);
  const y = h === null ? rawY : Math.min(rawY, 100 - h);
  return {
    id: stableIdOrNull(value.id),
    type,
    x,
    y,
    w,
    h,
    zIndex: optionalClampNumber(value.zIndex, -10, 50),
    opacity: optionalClampNumber(value.opacity, 0, 1),
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
  const h = optionalClampNumber(value.h, 1, 100);
  if (rawX === null || rawY === null || w === null) return null;

  const x = Math.min(rawX, 100 - w);
  const y = h === null ? Math.min(rawY, 92) : Math.min(rawY, 100 - h);

  return {
    id: stableIdOrNull(value.id),
    type,
    text: optionalText(value.text, type === "paragraph" ? 600 : 160),
    x,
    y,
    w,
    h,
    zIndex: optionalClampNumber(value.zIndex, -10, 50),
    fontSizePx: optionalClampNumber(value.fontSizePx, 8, 160),
    fontWeight: sanitizeFontWeight(value.fontWeight),
    color: hexColorOrNull(value.color),
    align: sanitizeTextAlign(value.align),
    letterSpacingPx: optionalClampNumber(value.letterSpacingPx, -2, 24),
    lineHeight: optionalClampNumber(value.lineHeight, 0.8, 2.5),
    opacity: optionalClampNumber(value.opacity, 0, 1),
    backgroundColor: hexColorOrNull(value.backgroundColor),
    borderColor: hexColorOrNull(value.borderColor),
    borderWidthPx: optionalClampNumber(value.borderWidthPx, 0, 8),
    radiusPx: optionalClampNumber(value.radiusPx, 0, 999),
    shadow: sanitizeShadow(value.shadow),
    blur: sanitizeBlur(value.blur),
    action: type === "button" ? sanitizeRealAction(value.action) : null,
    imageSlot: type === "image" ? sanitizeImageSlot(value.imageSlot) : null,
    imageFit: type === "image" ? sanitizeImageFit(value.imageFit) : null,
    imagePosition: type === "image" ? sanitizeImagePosition(value.imagePosition) : null,
    icon: type === "button" ? sanitizeLayoutIcon(value.icon) : null,
    buttonStyle: type === "button" ? sanitizeButtonStyle(value.buttonStyle) : null,
    mobile: sanitizeMobileLayout(value.mobile),
  };
}

const ASSUMED_DESIGN_WIDTH_PX = 1280;
const ASSUMED_DESIGN_HEIGHT_PX = 800;

function estimateElementHeightPct(element: PositionedElement, sectionHeightVh: number): number {
  if (element.h !== null && element.h !== undefined) return element.h;
  if (element.type === "button" || element.type === "badge" || element.type === "image" || !element.text) return 8;
  const fontSizePx = element.fontSizePx ?? 16;
  const widthPx = (element.w / 100) * ASSUMED_DESIGN_WIDTH_PX;
  const avgCharPx = fontSizePx * (element.type === "heading" || element.type === "subheading" ? 0.72 : 0.52);
  const charsPerLine = Math.max(1, Math.floor(widthPx / avgCharPx));
  const lines = Math.max(1, Math.ceil(element.text.length / charsPerLine));
  const heightPx = lines * fontSizePx * 1.5;
  const sectionHeightPx = Math.max((sectionHeightVh / 100) * ASSUMED_DESIGN_HEIGHT_PX, 1);
  return (heightPx / sectionHeightPx) * 100;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function enforceMinimumVerticalGaps(elements: PositionedElement[], sectionHeightVh: number): PositionedElement[] {
  // Reference Fidelity V2 trusts measured bounding boxes. The legacy safety
  // pass remains only for old precise layouts that have no explicit heights.
  if (elements.some((element) => element.h !== null && element.h !== undefined)) return elements;

  const order = elements.map((element, index) => ({ element, index }));
  const sortedByY = [...order].sort((a, b) => a.element.y - b.element.y);
  const placed: Array<{ x0: number; x1: number; bottom: number }> = [];
  const adjustedY = new Map<number, number>();

  for (const { element, index } of sortedByY) {
    const x0 = element.x;
    const x1 = element.x + element.w;
    let minY = element.y;
    for (const slot of placed) {
      if (rangesOverlap(x0, x1, slot.x0, slot.x1)) minY = Math.max(minY, slot.bottom);
    }
    const finalY = Math.min(Math.max(minY, element.y), 95);
    adjustedY.set(index, finalY);
    placed.push({ x0, x1, bottom: finalY + estimateElementHeightPct(element, sectionHeightVh) + 1 });
  }

  return elements.map((element, index) => ({ ...element, y: adjustedY.get(index) ?? element.y }));
}

function sanitizePreciseSection(raw: unknown, allowColumns = true): PreciseSection | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const type = typeof value.type === "string" && (LAYOUT_SECTION_TYPES as readonly string[]).includes(value.type)
    ? (value.type as LayoutSectionType)
    : null;
  if (!type) return null;

  const heightVh = clampNumber(value.heightVh, 20, 150, 60);
  const widthPct = optionalClampNumber(value.widthPct, 5, 100);
  const xPct = optionalClampNumber(value.xPct, 0, 95);

  const rawBackground = value.background && typeof value.background === "object" ? (value.background as Record<string, unknown>) : null;
  const background = rawBackground
    ? {
        color: hexColorOrNull(rawBackground.color),
        imageSlot: sanitizeImageSlot(rawBackground.imageSlot),
        fit: sanitizeImageFit(rawBackground.fit),
        position: sanitizeImagePosition(rawBackground.position),
        overlayOpacity: optionalClampNumber(rawBackground.overlayOpacity, 0, 0.9),
      }
    : null;

  const rawElements = Array.isArray(value.elements)
    ? value.elements
        .map(sanitizePositionedElement)
        .filter((element): element is PositionedElement => element !== null)
        .slice(0, MAX_PRECISE_ELEMENTS_PER_SECTION)
    : [];
  const elements = enforceMinimumVerticalGaps(rawElements, heightVh);

  const rawStyleHint = value.styleHint && typeof value.styleHint === "object" ? (value.styleHint as Record<string, unknown>) : null;
  const styleHint = rawStyleHint
    ? {
        heading: optionalText(rawStyleHint.heading, 60),
        cardStyle: sanitizeCardStyle(rawStyleHint.cardStyle),
        columns: optionalClampNumber(rawStyleHint.columns, 1, 6),
        gapPx: optionalClampNumber(rawStyleHint.gapPx, 0, 80),
        paddingPx: optionalClampNumber(rawStyleHint.paddingPx, 0, 120),
        radiusPx: optionalClampNumber(rawStyleHint.radiusPx, 0, 80),
        borderColor: hexColorOrNull(rawStyleHint.borderColor),
        backgroundColor: hexColorOrNull(rawStyleHint.backgroundColor),
        cardRadiusPx: optionalClampNumber(rawStyleHint.cardRadiusPx, 0, 80),
        cardBorderColor: hexColorOrNull(rawStyleHint.cardBorderColor),
        cardBackgroundColor: hexColorOrNull(rawStyleHint.cardBackgroundColor),
      }
    : null;

  const decorations = Array.isArray(value.decorations)
    ? value.decorations
        .map(sanitizeDecoration)
        .filter((decoration): decoration is Decoration => decoration !== null)
        .slice(0, MAX_PRECISE_ELEMENTS_PER_SECTION)
    : [];

  const columns = allowColumns && Array.isArray(value.columns)
    ? value.columns
        .map((column) => sanitizePreciseSection(column, false))
        .filter((column): column is PreciseSection => column !== null)
        .slice(0, MAX_COLUMNS)
    : [];

  if (elements.length === 0 && !styleHint && columns.length === 0) return null;
  if (elements.length === 0 && columns.length === 0 && styleHint && !(PRECISE_DYNAMIC_SECTION_TYPES as readonly string[]).includes(type)) {
    return null;
  }

  return {
    id: stableIdOrNull(value.id),
    type,
    heightVh,
    widthPct,
    xPct,
    background,
    elements,
    styleHint,
    decorations,
    columns,
  };
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

export function pickAccentFromPalette(rawPalette: unknown): string | null {
  if (!Array.isArray(rawPalette)) return null;
  const valid = rawPalette.filter((color): color is string => typeof color === "string" && HEX_COLOR_RE.test(color));
  if (valid.length === 0) return null;
  if (valid.length <= 2) return valid[0];
  const interior = valid.slice(1, -1);
  return interior[Math.floor((interior.length - 1) / 2)];
}

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

  if (layoutKind === "precise") {
    if (preciseSections.length === 0) return null;
  } else if (sections.length === 0) {
    return null;
  }

  const sectionTypes = new Set((layoutKind === "precise" ? preciseSections : sections).map((section) => section.type));
  const requestedSchemaVersion = value.schema_version === 2 ? 2 : value.schema_version === 1 ? 1 : undefined;
  const hasV2Fields = preciseSections.some((section) =>
    section.elements?.some((element) => element.h !== null && element.h !== undefined || Boolean(element.id)) ||
    section.decorations?.some((decoration) => decoration.h !== null && decoration.h !== undefined || Boolean(decoration.id)),
  );

  return {
    schema_version: layoutKind === "precise" && (requestedSchemaVersion === 2 || hasV2Fields) ? 2 : requestedSchemaVersion,
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
