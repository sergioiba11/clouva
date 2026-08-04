// Esquema fijo de "página custom" generada por CLOUVA AI Profile -- Gemini
// nunca produce HTML/JSX, solo esta estructura JSON (guardada en
// player_profile_versions.layout_config), interpretada por un renderer React
// fijo (components/public/StudioLayoutRenderer.tsx). Deliberadamente NO
// incluye URLs de imagen: las imágenes reales (portada/logo/galería) siguen
// viniendo de asset_references/los datos del Estudio ya existentes, nunca de
// este JSON -- así layout_config solo puede describir texto, modo, variante
// de sección y color, nunca inyectar una URL arbitraria.
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

export type HeroSection = {
  type: "hero";
  variant: SectionVariant<"hero">;
  headline: string;
  subheadline?: string | null;
};

export type AboutSection = {
  type: "about";
  variant: SectionVariant<"about">;
  heading: string;
  body: string;
};

export type PillarItem = { title: string; description: string };

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
};

export type LayoutNavItem = { label: string; section: LayoutSectionType };

export type LayoutFooter = { heading: string; cta_label: string; cta_section: LayoutSectionType };

export type LayoutConfig = {
  mode: LayoutMode;
  sections: LayoutSection[];
  page_style?: PageStyle | null;
  nav_items?: LayoutNavItem[] | null;
  footer?: LayoutFooter | null;
};

const MAX_SECTIONS = 9;
const MAX_PILLAR_ITEMS = 4;
const MAX_NAV_ITEMS = 6;

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

function sanitizeSection(raw: unknown): LayoutSection | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const type = value.type;

  switch (type) {
    case "hero": {
      const headline = text(value.headline, 120);
      if (!headline) return null;
      return { type: "hero", variant: sanitizeVariant("hero", value.variant), headline, subheadline: optionalText(value.subheadline, 200) };
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
              return title && description ? { title, description } : null;
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
  if (!theme && !palette && !radius && !navStyle) return null;
  return { theme, palette, radius, nav_style: navStyle };
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
  const sections = Array.isArray(value.sections)
    ? value.sections.map(sanitizeSection).filter((section): section is LayoutSection => section !== null).slice(0, MAX_SECTIONS)
    : [];
  if (sections.length === 0) return null;

  const sectionTypes = new Set(sections.map((section) => section.type));
  const mode: LayoutMode = value.mode === "reference_layout" ? "reference_layout" : "adaptive_layout";

  return {
    mode,
    sections,
    page_style: sanitizePageStyle(value.page_style),
    nav_items: sanitizeNavItems(value.nav_items, sectionTypes),
    footer: sanitizeFooter(value.footer, sectionTypes),
  };
}
