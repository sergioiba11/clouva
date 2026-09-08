// Canonical structured layout contract for CLOUVA public Player/Studio pages.
// Gemini never returns HTML/CSS/JSX. It only returns this closed JSON shape,
// which is sanitized before it reaches the renderer or persistence layer.

export const LAYOUT_SECTION_TYPES = ["hero", "about", "pillars", "gallery", "roster", "services", "membership", "music", "contact"] as const;
export type LayoutSectionType = (typeof LAYOUT_SECTION_TYPES)[number];
export const LAYOUT_MODES = ["reference_layout", "adaptive_layout"] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];
export const LAYOUT_KINDS = ["template", "precise"] as const;
export type LayoutKind = (typeof LAYOUT_KINDS)[number];
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

export type HeroSection = { type: "hero"; variant: SectionVariant<"hero">; headline: string; subheadline?: string | null; primaryLabel?: string | null; primaryIcon?: LayoutIconName | null; secondaryLabel?: string | null; secondaryIcon?: LayoutIconName | null };
export type AboutSection = { type: "about"; variant: SectionVariant<"about">; heading: string; body: string };
export type PillarItem = { title: string; description: string; image?: string | null; icon?: LayoutIconName | null };
export type PillarsSection = { type: "pillars"; variant: SectionVariant<"pillars">; heading: string; items: PillarItem[] };
export type GallerySection = { type: "gallery"; variant: SectionVariant<"gallery">; heading?: string | null };
export type RosterSection = { type: "roster"; variant: SectionVariant<"roster">; heading?: string | null };
export type ServicesSection = { type: "services"; variant: SectionVariant<"services">; heading?: string | null };
export type MembershipSection = { type: "membership"; variant: SectionVariant<"membership">; heading?: string | null };
export type ContactSection = { type: "contact"; variant: SectionVariant<"contact">; heading?: string | null };
export type MusicSection = { type: "music"; variant: SectionVariant<"music">; heading?: string | null };
export type LayoutSection = HeroSection | AboutSection | PillarsSection | GallerySection | RosterSection | ServicesSection | MembershipSection | MusicSection | ContactSection;

// V3 semantic slots. Model output can reference these names but never URLs.
export const IMAGE_SLOTS = [
  "cover", "logo", "brand-lockup", "avatar", "hero-primary", "hero-secondary",
  "pillar-0", "pillar-1", "pillar-2", "pillar-3", "background-0",
] as const;
export type FixedImageSlot = (typeof IMAGE_SLOTS)[number];
export type ImageSlot = FixedImageSlot
  | `pillar-${number}` | `gallery-${number}` | `player-${number}` | `release-${number}`
  | `service-${number}` | `membership-${number}` | `background-${number}` | `media-${number}` | `project-${number}`;

export type RealAction = "join" | "share" | `scroll:${LayoutSectionType}`;
export const POSITIONED_ELEMENT_TYPES = ["eyebrow", "heading", "subheading", "paragraph", "button", "badge", "image", "dynamic"] as const;
export type PositionedElementType = (typeof POSITIONED_ELEMENT_TYPES)[number];
export const FONT_WEIGHTS = [400, 500, 600, 700, 800, 900] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];
export const FONT_FAMILY_TOKENS = ["system", "display", "editorial", "sans", "condensed", "mono", "serif"] as const;
export type FontFamilyToken = (typeof FONT_FAMILY_TOKENS)[number];
export const TEXT_TRANSFORMS = ["none", "uppercase", "lowercase", "capitalize"] as const;
export type TextTransform = (typeof TEXT_TRANSFORMS)[number];
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
export const DECORATION_TYPES = ["waveform", "scroll-indicator", "vertical-label", "divider-line", "line", "circle", "rectangle", "glow", "gradient-block"] as const;
export type DecorationType = (typeof DECORATION_TYPES)[number];
export const DYNAMIC_WIDGET_TYPES = [
  "now-playing", "featured-release", "release-card", "player-card", "player-grid", "service-card",
  "membership-card", "gallery-item", "social-link", "cta", "stat", "media-card", "project-card", "section-title",
] as const;
export type DynamicWidgetType = (typeof DYNAMIC_WIDGET_TYPES)[number];
export const DYNAMIC_VARIANTS = ["default", "compact", "editorial", "card", "list", "grid", "minimal"] as const;
export type DynamicVariant = (typeof DYNAMIC_VARIANTS)[number];

export type MobileElementLayout = { hidden?: boolean; order?: number | null; w?: number | null; align?: TextAlign | null };
export type Decoration = {
  id?: string | null; type: DecorationType; x: number; y: number; w?: number | null; h?: number | null;
  zIndex?: number | null; opacity?: number | null; text?: string | null; color?: string | null; backgroundColor?: string | null;
  borderColor?: string | null; borderWidthPx?: number | null; radiusPx?: number | null; blur?: BlurPreset | null;
};

export type PositionedElement = {
  id?: string | null; type: PositionedElementType; text?: string | null; x: number; y: number; w: number; h?: number | null;
  zIndex?: number | null; fontSizePx?: number | null; fontWeight?: FontWeight | null; fontFamilyToken?: FontFamilyToken | null;
  textTransform?: TextTransform | null; color?: string | null; align?: TextAlign | null; letterSpacingPx?: number | null; lineHeight?: number | null;
  opacity?: number | null; backgroundColor?: string | null; borderColor?: string | null; borderWidthPx?: number | null; radiusPx?: number | null;
  shadow?: ShadowPreset | null; blur?: BlurPreset | null; action?: RealAction | null; imageSlot?: ImageSlot | null; imageFit?: ImageFit | null;
  imagePosition?: ImagePosition | null; icon?: LayoutIconName | null; buttonStyle?: ButtonStyle | null; mobile?: MobileElementLayout | null;
  widget?: DynamicWidgetType | null; dataIndex?: number | null; variant?: DynamicVariant | null; columns?: number | null; gapPx?: number | null;
};

export type PreciseSectionStyleHint = {
  heading?: string | null; cardStyle?: CardStyle | null; columns?: number | null; gapPx?: number | null; paddingPx?: number | null;
  radiusPx?: number | null; borderColor?: string | null; backgroundColor?: string | null; cardRadiusPx?: number | null;
  cardBorderColor?: string | null; cardBackgroundColor?: string | null;
};
export type PreciseSection = {
  id?: string | null; type: LayoutSectionType; heightVh: number; widthPct?: number | null; xPct?: number | null;
  background?: { color?: string | null; imageSlot?: ImageSlot | null; fit?: ImageFit | null; position?: ImagePosition | null; overlayOpacity?: number | null } | null;
  elements?: PositionedElement[]; styleHint?: PreciseSectionStyleHint | null; decorations?: Decoration[]; columns?: PreciseSection[];
};

export type PagePalette = { background?: string; surface?: string; text?: string; muted_text?: string; accent?: string; border?: string };
export const RADIUS_VALUES = ["none", "small", "medium", "large"] as const;
export type RadiusValue = (typeof RADIUS_VALUES)[number];
export const NAV_STYLES = ["pill", "bar"] as const;
export type NavStyle = (typeof NAV_STYLES)[number];
export type PageStyle = { theme?: "dark" | "light" | "mixed"; palette?: PagePalette | null; radius?: RadiusValue; nav_style?: NavStyle; header_overlay?: boolean };
export type LayoutNavItem = { label: string; section: LayoutSectionType };
export type LayoutFooter = { heading: string; cta_label: string; cta_section: LayoutSectionType };
export type ImageSlotMap = Partial<Record<ImageSlot, string>>;

export const HEADER_MODES = ["normal", "overlay", "floating", "sticky"] as const;
export type HeaderMode = (typeof HEADER_MODES)[number];
export const HEADER_ALIGNMENTS = ["left", "center", "right", "between"] as const;
export type HeaderAlignment = (typeof HEADER_ALIGNMENTS)[number];
export type HeaderConfig = {
  mode: HeaderMode; heightPx?: number | null; widthPct?: number | null; xPct?: number | null; yPx?: number | null;
  backgroundColor?: string | null; opacity?: number | null; blur?: BlurPreset | null; borderColor?: string | null; borderWidthPx?: number | null; radiusPx?: number | null;
  brand?: { imageSlot?: ImageSlot | null; showText?: boolean; widthPx?: number | null; heightPx?: number | null; fit?: ImageFit | null; align?: HeaderAlignment | null } | null;
  nav?: { align?: HeaderAlignment | null; gapPx?: number | null; fontFamilyToken?: FontFamilyToken | null; fontSizePx?: number | null; uppercase?: boolean } | null;
  cta?: { label?: string | null; action?: RealAction | null; buttonStyle?: ButtonStyle | null } | null;
};
export type ReferenceViewportConfig = { width: number; height: number; aspectRatio: number };

export type LayoutConfig = {
  schema_version?: 1 | 2 | 3; mode: LayoutMode; layout_kind: LayoutKind; sections: LayoutSection[]; precise_sections: PreciseSection[];
  image_slots: ImageSlotMap; page_style?: PageStyle | null; header?: HeaderConfig | null; reference_viewport?: ReferenceViewportConfig | null;
  nav_items?: LayoutNavItem[] | null; footer?: LayoutFooter | null;
};

const MAX_SECTIONS = 9;
const MAX_PILLAR_ITEMS = 4;
const MAX_NAV_ITEMS = 8;
const MAX_PRECISE_ELEMENTS_PER_SECTION = 32;
const MAX_COLUMNS = 4;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const STABLE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const SEMANTIC_SLOT_RE = /^(?:pillar|gallery|player|release|service|membership|background|media|project)-(?:[0-9]|1[0-5])$/;
const TRUSTED_ASSET_HOST_RE = /(?:^|\.)(?:storage\.googleapis\.com|supabase\.co|supabase\.in|clouva\.com\.ar)$/i;

function text(value: unknown, maxLength: number) { return typeof value === "string" ? value.trim().slice(0, maxLength) : ""; }
function optionalText(value: unknown, maxLength: number): string | null { const cleaned = text(value, maxLength); return cleaned || null; }
function stableIdOrNull(value: unknown): string | null { return typeof value === "string" && STABLE_ID_RE.test(value) ? value : null; }
function clampNumber(value: unknown, min: number, max: number, fallback: number) { const n = typeof value === "number" && Number.isFinite(value) ? value : fallback; return Math.min(max, Math.max(min, n)); }
function optionalClampNumber(value: unknown, min: number, max: number): number | null { return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null; }
function hexColorOrNull(value: unknown): string | null { return typeof value === "string" && HEX_COLOR_RE.test(value) ? value : null; }

function trustedHttpsUrlOrNull(value: unknown, maxLength = 1000): string | null {
  const cleaned = text(value, maxLength); if (!cleaned) return null;
  try { const url = new URL(cleaned); return url.protocol === "https:" && TRUSTED_ASSET_HOST_RE.test(url.hostname) ? cleaned : null; } catch { return null; }
}
function httpsUrlOrNull(value: unknown, maxLength = 1000): string | null {
  const cleaned = text(value, maxLength); if (!cleaned) return null;
  try { return new URL(cleaned).protocol === "https:" ? cleaned : null; } catch { return null; }
}
function sanitizeVariant<T extends LayoutSectionType>(type: T, raw: unknown): SectionVariant<T> { const allowed = SECTION_VARIANTS[type] as readonly string[]; return (typeof raw === "string" && allowed.includes(raw) ? raw : allowed[0]) as SectionVariant<T>; }
function sanitizeLayoutIcon(raw: unknown): LayoutIconName | null { return typeof raw === "string" && (LAYOUT_ICONS as readonly string[]).includes(raw) ? raw as LayoutIconName : null; }
function sanitizeFontWeight(raw: unknown): FontWeight | null { return typeof raw === "number" && (FONT_WEIGHTS as readonly number[]).includes(raw) ? raw as FontWeight : null; }
function sanitizeFontFamilyToken(raw: unknown): FontFamilyToken | null { return typeof raw === "string" && (FONT_FAMILY_TOKENS as readonly string[]).includes(raw) ? raw as FontFamilyToken : null; }
function sanitizeTextTransform(raw: unknown): TextTransform | null { return typeof raw === "string" && (TEXT_TRANSFORMS as readonly string[]).includes(raw) ? raw as TextTransform : null; }
function sanitizeTextAlign(raw: unknown): TextAlign | null { return typeof raw === "string" && (TEXT_ALIGNS as readonly string[]).includes(raw) ? raw as TextAlign : null; }
function sanitizeCardStyle(raw: unknown): CardStyle | null { return typeof raw === "string" && (CARD_STYLES as readonly string[]).includes(raw) ? raw as CardStyle : null; }
function sanitizeButtonStyle(raw: unknown): ButtonStyle | null { return typeof raw === "string" && (BUTTON_STYLES as readonly string[]).includes(raw) ? raw as ButtonStyle : null; }
function sanitizeImageFit(raw: unknown): ImageFit | null { return typeof raw === "string" && (IMAGE_FITS as readonly string[]).includes(raw) ? raw as ImageFit : null; }
function sanitizeImagePosition(raw: unknown): ImagePosition | null { return typeof raw === "string" && (IMAGE_POSITIONS as readonly string[]).includes(raw) ? raw as ImagePosition : null; }
function sanitizeShadow(raw: unknown): ShadowPreset | null { return typeof raw === "string" && (SHADOW_PRESETS as readonly string[]).includes(raw) ? raw as ShadowPreset : null; }
function sanitizeBlur(raw: unknown): BlurPreset | null { return typeof raw === "string" && (BLUR_PRESETS as readonly string[]).includes(raw) ? raw as BlurPreset : null; }
function sanitizeDynamicWidget(raw: unknown): DynamicWidgetType | null { return typeof raw === "string" && (DYNAMIC_WIDGET_TYPES as readonly string[]).includes(raw) ? raw as DynamicWidgetType : null; }
function sanitizeDynamicVariant(raw: unknown): DynamicVariant | null { return typeof raw === "string" && (DYNAMIC_VARIANTS as readonly string[]).includes(raw) ? raw as DynamicVariant : null; }
function sanitizeDecorationType(raw: unknown): DecorationType | null { return typeof raw === "string" && (DECORATION_TYPES as readonly string[]).includes(raw) ? raw as DecorationType : null; }

export function sanitizeImageSlot(raw: unknown): ImageSlot | null {
  if (typeof raw !== "string") return null;
  if ((IMAGE_SLOTS as readonly string[]).includes(raw) || SEMANTIC_SLOT_RE.test(raw)) return raw as ImageSlot;
  return null;
}
const SCROLL_ACTIONS = new Set(LAYOUT_SECTION_TYPES.map((type) => `scroll:${type}`));
export function sanitizeRealAction(raw: unknown): RealAction | null { if (raw === "join" || raw === "share") return raw; return typeof raw === "string" && SCROLL_ACTIONS.has(raw) ? raw as RealAction : null; }

function sanitizeSection(raw: unknown): LayoutSection | null {
  if (!raw || typeof raw !== "object") return null; const v = raw as Record<string, unknown>;
  switch (v.type) {
    case "hero": { const headline = text(v.headline, 120); if (!headline) return null; return { type: "hero", variant: sanitizeVariant("hero", v.variant), headline, subheadline: optionalText(v.subheadline, 200), primaryLabel: optionalText(v.primaryLabel, 40), primaryIcon: sanitizeLayoutIcon(v.primaryIcon), secondaryLabel: optionalText(v.secondaryLabel, 40), secondaryIcon: sanitizeLayoutIcon(v.secondaryIcon) }; }
    case "about": { const body = text(v.body, 1200); if (!body) return null; return { type: "about", variant: sanitizeVariant("about", v.variant), heading: text(v.heading, 60) || "Sobre nosotros", body }; }
    case "pillars": { const items = Array.isArray(v.items) ? v.items.map((item): PillarItem | null => { if (!item || typeof item !== "object") return null; const row = item as Record<string, unknown>; const title = text(row.title, 60), description = text(row.description, 240); if (!title || !description) return null; return { title, description, image: httpsUrlOrNull(row.image, 500), icon: sanitizeLayoutIcon(row.icon) }; }).filter((x): x is PillarItem => x !== null).slice(0, MAX_PILLAR_ITEMS) : []; if (items.length < 2) return null; return { type: "pillars", variant: sanitizeVariant("pillars", v.variant), heading: text(v.heading, 60) || "Nuestros pilares", items }; }
    case "gallery": return { type: "gallery", variant: sanitizeVariant("gallery", v.variant), heading: optionalText(v.heading, 60) };
    case "roster": return { type: "roster", variant: sanitizeVariant("roster", v.variant), heading: optionalText(v.heading, 60) };
    case "services": return { type: "services", variant: sanitizeVariant("services", v.variant), heading: optionalText(v.heading, 60) };
    case "membership": return { type: "membership", variant: sanitizeVariant("membership", v.variant), heading: optionalText(v.heading, 60) };
    case "music": return { type: "music", variant: sanitizeVariant("music", v.variant), heading: optionalText(v.heading, 60) };
    case "contact": return { type: "contact", variant: sanitizeVariant("contact", v.variant), heading: optionalText(v.heading, 60) };
    default: return null;
  }
}

function sanitizeMobileLayout(raw: unknown): MobileElementLayout | null {
  if (!raw || typeof raw !== "object") return null; const v = raw as Record<string, unknown>;
  const result: MobileElementLayout = { hidden: v.hidden === true, order: optionalClampNumber(v.order, -20, 100), w: optionalClampNumber(v.w, 10, 100), align: sanitizeTextAlign(v.align) };
  return result.hidden || result.order !== null || result.w !== null || result.align !== null ? result : null;
}
function sanitizeDecoration(raw: unknown): Decoration | null {
  if (!raw || typeof raw !== "object") return null; const v = raw as Record<string, unknown>; const type = sanitizeDecorationType(v.type); if (!type) return null;
  const rawX = optionalClampNumber(v.x, 0, 100), rawY = optionalClampNumber(v.y, 0, 100); if (rawX === null || rawY === null) return null;
  const w = optionalClampNumber(v.w, .2, 100), h = optionalClampNumber(v.h, .2, 100); const x = w === null ? rawX : Math.min(rawX, 100 - w), y = h === null ? rawY : Math.min(rawY, 100 - h);
  return { id: stableIdOrNull(v.id), type, x, y, w, h, zIndex: optionalClampNumber(v.zIndex, -10, 50), opacity: optionalClampNumber(v.opacity, 0, 1), text: type === "vertical-label" ? optionalText(v.text, 60) : null, color: hexColorOrNull(v.color), backgroundColor: hexColorOrNull(v.backgroundColor), borderColor: hexColorOrNull(v.borderColor), borderWidthPx: optionalClampNumber(v.borderWidthPx, 0, 8), radiusPx: optionalClampNumber(v.radiusPx, 0, 999), blur: sanitizeBlur(v.blur) };
}
function sanitizePositionedElement(raw: unknown): PositionedElement | null {
  if (!raw || typeof raw !== "object") return null; const v = raw as Record<string, unknown>;
  const type = typeof v.type === "string" && (POSITIONED_ELEMENT_TYPES as readonly string[]).includes(v.type) ? v.type as PositionedElementType : null; if (!type) return null;
  const rawX = optionalClampNumber(v.x, 0, 100), rawY = optionalClampNumber(v.y, 0, 100), w = optionalClampNumber(v.w, 1, 100), h = optionalClampNumber(v.h, 1, 100); if (rawX === null || rawY === null || w === null) return null;
  const x = Math.min(rawX, 100 - w), y = h === null ? Math.min(rawY, 92) : Math.min(rawY, 100 - h);
  return {
    id: stableIdOrNull(v.id), type, text: optionalText(v.text, type === "paragraph" ? 600 : 160), x, y, w, h,
    zIndex: optionalClampNumber(v.zIndex, -10, 50), fontSizePx: optionalClampNumber(v.fontSizePx, 8, 180), fontWeight: sanitizeFontWeight(v.fontWeight),
    fontFamilyToken: sanitizeFontFamilyToken(v.fontFamilyToken), textTransform: sanitizeTextTransform(v.textTransform), color: hexColorOrNull(v.color), align: sanitizeTextAlign(v.align),
    letterSpacingPx: optionalClampNumber(v.letterSpacingPx, -4, 28), lineHeight: optionalClampNumber(v.lineHeight, .7, 3), opacity: optionalClampNumber(v.opacity, 0, 1),
    backgroundColor: hexColorOrNull(v.backgroundColor), borderColor: hexColorOrNull(v.borderColor), borderWidthPx: optionalClampNumber(v.borderWidthPx, 0, 8), radiusPx: optionalClampNumber(v.radiusPx, 0, 999),
    shadow: sanitizeShadow(v.shadow), blur: sanitizeBlur(v.blur), action: type === "button" ? sanitizeRealAction(v.action) : null,
    imageSlot: type === "image" ? sanitizeImageSlot(v.imageSlot) : null, imageFit: type === "image" ? sanitizeImageFit(v.imageFit) : null, imagePosition: type === "image" ? sanitizeImagePosition(v.imagePosition) : null,
    icon: type === "button" ? sanitizeLayoutIcon(v.icon) : null, buttonStyle: type === "button" ? sanitizeButtonStyle(v.buttonStyle) : null, mobile: sanitizeMobileLayout(v.mobile),
    widget: type === "dynamic" ? sanitizeDynamicWidget(v.widget) : null, dataIndex: type === "dynamic" ? optionalClampNumber(v.dataIndex, 0, 99) : null,
    variant: type === "dynamic" ? sanitizeDynamicVariant(v.variant) : null, columns: type === "dynamic" ? optionalClampNumber(v.columns, 1, 6) : null, gapPx: type === "dynamic" ? optionalClampNumber(v.gapPx, 0, 80) : null,
  };
}

const ASSUMED_DESIGN_WIDTH_PX = 1280, ASSUMED_DESIGN_HEIGHT_PX = 800;
function estimateElementHeightPct(e: PositionedElement, sectionHeightVh: number) { if (e.h != null) return e.h; if (["button", "badge", "image", "dynamic"].includes(e.type) || !e.text) return 8; const fs = e.fontSizePx ?? 16, widthPx = e.w / 100 * ASSUMED_DESIGN_WIDTH_PX, avg = fs * (["heading", "subheading"].includes(e.type) ? .72 : .52), lines = Math.max(1, Math.ceil(e.text.length / Math.max(1, Math.floor(widthPx / avg)))), heightPx = lines * fs * 1.5, sectionPx = Math.max(sectionHeightVh / 100 * ASSUMED_DESIGN_HEIGHT_PX, 1); return heightPx / sectionPx * 100; }
function rangesOverlap(a0: number, a1: number, b0: number, b1: number) { return a0 < b1 && b0 < a1; }
function enforceMinimumVerticalGaps(elements: PositionedElement[], heightVh: number) { if (elements.some((e) => e.h != null)) return elements; const placed: Array<{x0:number;x1:number;bottom:number}> = [], adjusted = new Map<number, number>(); [...elements.map((element,index)=>({element,index}))].sort((a,b)=>a.element.y-b.element.y).forEach(({element,index})=>{ let minY=element.y; for(const slot of placed) if(rangesOverlap(element.x,element.x+element.w,slot.x0,slot.x1)) minY=Math.max(minY,slot.bottom); const y=Math.min(Math.max(minY,element.y),95); adjusted.set(index,y); placed.push({x0:element.x,x1:element.x+element.w,bottom:y+estimateElementHeightPct(element,heightVh)+1}); }); return elements.map((e,i)=>({...e,y:adjusted.get(i)??e.y})); }

function sanitizePreciseSection(raw: unknown, allowColumns = true): PreciseSection | null {
  if (!raw || typeof raw !== "object") return null; const v = raw as Record<string, unknown>;
  const type = typeof v.type === "string" && (LAYOUT_SECTION_TYPES as readonly string[]).includes(v.type) ? v.type as LayoutSectionType : null; if (!type) return null;
  const heightVh = clampNumber(v.heightVh, 20, 180, 60), widthPct = optionalClampNumber(v.widthPct, 5, 100), xPct = optionalClampNumber(v.xPct, 0, 95);
  const rb = v.background && typeof v.background === "object" ? v.background as Record<string, unknown> : null;
  const background = rb ? { color: hexColorOrNull(rb.color), imageSlot: sanitizeImageSlot(rb.imageSlot), fit: sanitizeImageFit(rb.fit), position: sanitizeImagePosition(rb.position), overlayOpacity: optionalClampNumber(rb.overlayOpacity, 0, .95) } : null;
  const rawElements = Array.isArray(v.elements) ? v.elements.map(sanitizePositionedElement).filter((x): x is PositionedElement => x !== null).slice(0, MAX_PRECISE_ELEMENTS_PER_SECTION) : [];
  const elements = enforceMinimumVerticalGaps(rawElements, heightVh);
  const sh = v.styleHint && typeof v.styleHint === "object" ? v.styleHint as Record<string, unknown> : null;
  const styleHint = sh ? { heading: optionalText(sh.heading, 60), cardStyle: sanitizeCardStyle(sh.cardStyle), columns: optionalClampNumber(sh.columns,1,6), gapPx: optionalClampNumber(sh.gapPx,0,80), paddingPx: optionalClampNumber(sh.paddingPx,0,120), radiusPx: optionalClampNumber(sh.radiusPx,0,80), borderColor: hexColorOrNull(sh.borderColor), backgroundColor: hexColorOrNull(sh.backgroundColor), cardRadiusPx: optionalClampNumber(sh.cardRadiusPx,0,80), cardBorderColor: hexColorOrNull(sh.cardBorderColor), cardBackgroundColor: hexColorOrNull(sh.cardBackgroundColor) } : null;
  const decorations = Array.isArray(v.decorations) ? v.decorations.map(sanitizeDecoration).filter((x): x is Decoration => x !== null).slice(0, MAX_PRECISE_ELEMENTS_PER_SECTION) : [];
  const columns = allowColumns && Array.isArray(v.columns) ? v.columns.map((x)=>sanitizePreciseSection(x,false)).filter((x): x is PreciseSection=>x!==null).slice(0,MAX_COLUMNS) : [];
  if (!elements.length && !styleHint && !columns.length) return null;
  if (!elements.length && !columns.length && styleHint && !(PRECISE_DYNAMIC_SECTION_TYPES as readonly string[]).includes(type)) return null;
  return { id: stableIdOrNull(v.id), type, heightVh, widthPct, xPct, background, elements, styleHint, decorations, columns };
}

function sanitizeImageSlotMap(raw: unknown): ImageSlotMap { if (!raw || typeof raw !== "object") return {}; const map: ImageSlotMap = {}; for (const [key,value] of Object.entries(raw as Record<string,unknown>)) { const slot=sanitizeImageSlot(key), url=trustedHttpsUrlOrNull(value,1000); if(slot&&url) map[slot]=url; } return map; }
function sanitizePalette(raw: unknown): PagePalette | null { if(!raw||typeof raw!=="object")return null; const v=raw as Record<string,unknown>, out:PagePalette={}; (["background","surface","text","muted_text","accent","border"] as const).forEach(k=>{const c=v[k];if(typeof c==="string"&&HEX_COLOR_RE.test(c))out[k]=c;}); return Object.keys(out).length?out:null; }
function sanitizePageStyle(raw: unknown): PageStyle | null { if(!raw||typeof raw!=="object")return null; const v=raw as Record<string,unknown>, theme=v.theme==="dark"||v.theme==="light"||v.theme==="mixed"?v.theme:undefined, palette=sanitizePalette(v.palette), radius=typeof v.radius==="string"&&(RADIUS_VALUES as readonly string[]).includes(v.radius)?v.radius as RadiusValue:undefined, nav=typeof v.nav_style==="string"&&(NAV_STYLES as readonly string[]).includes(v.nav_style)?v.nav_style as NavStyle:undefined, overlay=v.header_overlay===true; return !theme&&!palette&&!radius&&!nav&&!overlay?null:{theme,palette,radius,nav_style:nav,header_overlay:overlay}; }
function sanitizeHeaderAlignment(raw: unknown): HeaderAlignment | null { return typeof raw === "string" && (HEADER_ALIGNMENTS as readonly string[]).includes(raw) ? raw as HeaderAlignment : null; }
function sanitizeHeader(raw: unknown): HeaderConfig | null {
  if(!raw||typeof raw!=="object")return null; const v=raw as Record<string,unknown>; const mode=typeof v.mode==="string"&&(HEADER_MODES as readonly string[]).includes(v.mode)?v.mode as HeaderMode:"normal";
  const br=v.brand&&typeof v.brand==="object"?v.brand as Record<string,unknown>:null, nv=v.nav&&typeof v.nav==="object"?v.nav as Record<string,unknown>:null, ct=v.cta&&typeof v.cta==="object"?v.cta as Record<string,unknown>:null;
  return { mode, heightPx:optionalClampNumber(v.heightPx,44,180), widthPct:optionalClampNumber(v.widthPct,30,100), xPct:optionalClampNumber(v.xPct,0,70), yPx:optionalClampNumber(v.yPx,0,240), backgroundColor:hexColorOrNull(v.backgroundColor), opacity:optionalClampNumber(v.opacity,0,1), blur:sanitizeBlur(v.blur), borderColor:hexColorOrNull(v.borderColor), borderWidthPx:optionalClampNumber(v.borderWidthPx,0,8), radiusPx:optionalClampNumber(v.radiusPx,0,80), brand:br?{imageSlot:sanitizeImageSlot(br.imageSlot),showText:br.showText!==false,widthPx:optionalClampNumber(br.widthPx,24,420),heightPx:optionalClampNumber(br.heightPx,20,160),fit:sanitizeImageFit(br.fit),align:sanitizeHeaderAlignment(br.align)}:null, nav:nv?{align:sanitizeHeaderAlignment(nv.align),gapPx:optionalClampNumber(nv.gapPx,0,80),fontFamilyToken:sanitizeFontFamilyToken(nv.fontFamilyToken),fontSizePx:optionalClampNumber(nv.fontSizePx,9,24),uppercase:nv.uppercase===true}:null, cta:ct?{label:optionalText(ct.label,40),action:sanitizeRealAction(ct.action),buttonStyle:sanitizeButtonStyle(ct.buttonStyle)}:null };
}
function sanitizeReferenceViewport(raw: unknown): ReferenceViewportConfig | null { if(!raw||typeof raw!=="object")return null; const v=raw as Record<string,unknown>, width=optionalClampNumber(v.width,240,7680), height=optionalClampNumber(v.height,240,7680); if(width===null||height===null)return null; return {width:Math.round(width),height:Math.round(height),aspectRatio:Number((width/height).toFixed(6))}; }
function sanitizeFooter(raw: unknown, valid:Set<LayoutSectionType>):LayoutFooter|null { if(!raw||typeof raw!=="object")return null; const v=raw as Record<string,unknown>,heading=text(v.heading,80),label=text(v.cta_label,40),section=v.cta_section; return heading&&label&&typeof section==="string"&&valid.has(section as LayoutSectionType)?{heading,cta_label:label,cta_section:section as LayoutSectionType}:null; }
function sanitizeNavItems(raw: unknown, valid:Set<LayoutSectionType>):LayoutNavItem[]|null { if(!Array.isArray(raw))return null; const out=raw.map((item):LayoutNavItem|null=>{if(!item||typeof item!=="object")return null;const v=item as Record<string,unknown>,label=text(v.label,24),section=v.section;return label&&typeof section==="string"&&valid.has(section as LayoutSectionType)?{label,section:section as LayoutSectionType}:null;}).filter((x):x is LayoutNavItem=>x!==null).slice(0,MAX_NAV_ITEMS); return out.length?out:null; }

export function pickAccentFromPalette(rawPalette: unknown): string | null { if(!Array.isArray(rawPalette))return null; const valid=rawPalette.filter((c):c is string=>typeof c==="string"&&HEX_COLOR_RE.test(c)); if(!valid.length)return null;if(valid.length<=2)return valid[0];const inner=valid.slice(1,-1);return inner[Math.floor((inner.length-1)/2)]; }

export function sanitizeLayoutConfig(raw: unknown): LayoutConfig | null {
  if(!raw||typeof raw!=="object")return null; const v=raw as Record<string,unknown>; const mode:LayoutMode=v.mode==="reference_layout"?"reference_layout":"adaptive_layout", kind:LayoutKind=v.layout_kind==="precise"?"precise":"template";
  const sections=Array.isArray(v.sections)?v.sections.map(sanitizeSection).filter((x):x is LayoutSection=>x!==null).slice(0,MAX_SECTIONS):[];
  const precise=Array.isArray(v.precise_sections)?v.precise_sections.map((x)=>sanitizePreciseSection(x)).filter((x):x is PreciseSection=>x!==null).slice(0,MAX_SECTIONS):[];
  if(kind==="precise"&&!precise.length)return null;if(kind==="template"&&!sections.length)return null;
  const types=new Set((kind==="precise"?precise:sections).map(s=>s.type)); const requested=v.schema_version===3?3:v.schema_version===2?2:v.schema_version===1?1:undefined;
  const hasV3=Boolean(v.header||v.reference_viewport)||precise.some(s=>s.elements?.some(e=>e.type==="dynamic"||Boolean(e.fontFamilyToken)||Boolean(e.textTransform)));
  const hasV2=precise.some(s=>s.elements?.some(e=>e.h!=null||Boolean(e.id))||s.decorations?.some(d=>d.h!=null||Boolean(d.id)));
  const schema=kind==="precise"?(hasV3||requested===3?3:hasV2||requested===2?2:requested):requested;
  return { schema_version:schema, mode, layout_kind:kind, sections, precise_sections:precise, image_slots:sanitizeImageSlotMap(v.image_slots), page_style:sanitizePageStyle(v.page_style), header:sanitizeHeader(v.header), reference_viewport:sanitizeReferenceViewport(v.reference_viewport), nav_items:sanitizeNavItems(v.nav_items,types), footer:sanitizeFooter(v.footer,types) };
}
