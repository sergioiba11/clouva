export type MobileHomeSectionKey = "hero" | "music" | "features";

export type MobileHomeCardConfig = {
  visible: boolean;
  title: string;
  body: string;
  imageUrl: string;
  href: string;
};

export type MobileHomeConfig = {
  schemaVersion: 1;
  page: "mobile-home";
  theme: {
    backgroundColor: string;
    accentColor: string;
    accentSecondary: string;
    borderColor: string;
    pagePadding: number;
    sectionGap: number;
    radius: number;
    glowStrength: number;
  };
  header: {
    logoText: string;
    brandAvatarUrl: string;
    showBrandAvatar: boolean;
    showNotificationDot: boolean;
  };
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    imageUrl: string;
    height: number;
    textWidth: number;
    contentPaddingLeft: number;
    primaryLabel: string;
    primaryHref: string;
    secondaryLabel: string;
    secondaryHref: string;
  };
  music: {
    visible: boolean;
    coverUrl: string;
    title: string;
    artist: string;
    currentTime: string;
    duration: string;
    progress: number;
    favoriteDefault: boolean;
  };
  cards: {
    continue: MobileHomeCardConfig;
    iglu: MobileHomeCardConfig;
  };
  navigation: {
    homeLabel: string;
    avatarLabel: string;
    createLabel: string;
    marketplaceLabel: string;
  };
  sections: MobileHomeSectionKey[];
};

export const DEFAULT_MOBILE_HOME_CONFIG: MobileHomeConfig = {
  schemaVersion: 1,
  page: "mobile-home",
  theme: {
    backgroundColor: "#030307",
    accentColor: "#9d3ef5",
    accentSecondary: "#b251ff",
    borderColor: "rgba(136,45,226,0.44)",
    pagePadding: 16,
    sectionGap: 11,
    radius: 22,
    glowStrength: 0.55,
  },
  header: {
    logoText: "CLOUVA",
    brandAvatarUrl: "/assets/home-mobile/brand-avatar.webp",
    showBrandAvatar: true,
    showNotificationDot: true,
  },
  hero: {
    eyebrow: "Bienvenido de nuevo",
    title: "Crea. Personaliza.\nConecta.",
    subtitle: "Viví tu propio mundo.",
    imageUrl: "/assets/home-mobile/hero.webp",
    height: 310,
    textWidth: 58,
    contentPaddingLeft: 22,
    primaryLabel: "Entrar a mi Avatar",
    primaryHref: "/mi-flow/avatar",
    secondaryLabel: "Explorar Mundos",
    secondaryHref: "/matrix",
  },
  music: {
    visible: true,
    coverUrl: "/assets/home-mobile/music-cover.webp",
    title: "Vida de Flows",
    artist: "Clouva",
    currentTime: "1:32",
    duration: "3:24",
    progress: 61,
    favoriteDefault: true,
  },
  cards: {
    continue: {
      visible: true,
      title: "Continuar\ncreando",
      body: "Seguí diseñando\ntu próximo ítem.",
      imageUrl: "/assets/home-mobile/continue.webp",
      href: "/creator-studio",
    },
    iglu: {
      visible: true,
      title: "Entrar\nal Iglú",
      body: "Tu estudio.\nTu música.\nTu universo.",
      imageUrl: "/assets/home-mobile/iglu.webp",
      href: "/studios/iglu",
    },
  },
  navigation: {
    homeLabel: "Inicio",
    avatarLabel: "Avatar",
    createLabel: "Crear",
    marketplaceLabel: "Marketplace",
  },
  sections: ["hero", "music", "features"],
};

const ALLOWED_ROUTES = new Set([
  "/",
  "/mi-flow/avatar",
  "/matrix",
  "/creator-studio",
  "/mi-flow/music",
  "/tienda",
  "/perfil",
  "/studios/iglu",
]);

const SECTION_KEYS = new Set<MobileHomeSectionKey>(["hero", "music", "features"]);

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback: string, max = 120) {
  if (typeof value !== "string") return fallback;
  const normalized = value.replace(/\r/g, "").trim();
  return normalized ? normalized.slice(0, max) : fallback;
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function numberInRange(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function color(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const candidate = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(candidate)) return candidate;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(candidate)) return candidate;
  return fallback;
}

function imageUrl(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const candidate = value.trim();
  if (candidate.startsWith("/") && !candidate.startsWith("//")) return candidate.slice(0, 800);
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "https:") return candidate.slice(0, 800);
  } catch {
    return fallback;
  }
  return fallback;
}

function route(value: unknown, fallback: string) {
  return typeof value === "string" && ALLOWED_ROUTES.has(value) ? value : fallback;
}

function card(value: unknown, fallback: MobileHomeCardConfig): MobileHomeCardConfig {
  const source = objectValue(value);
  return {
    visible: bool(source.visible, fallback.visible),
    title: text(source.title, fallback.title, 80),
    body: text(source.body, fallback.body, 140),
    imageUrl: imageUrl(source.imageUrl, fallback.imageUrl),
    href: route(source.href, fallback.href),
  };
}

export function sanitizeMobileHomeConfig(value: unknown): MobileHomeConfig {
  const root = objectValue(value);
  const theme = objectValue(root.theme);
  const header = objectValue(root.header);
  const hero = objectValue(root.hero);
  const music = objectValue(root.music);
  const cards = objectValue(root.cards);
  const navigation = objectValue(root.navigation);

  const candidateSections = Array.isArray(root.sections)
    ? root.sections.filter((entry): entry is MobileHomeSectionKey => typeof entry === "string" && SECTION_KEYS.has(entry as MobileHomeSectionKey))
    : [];
  const sections = Array.from(new Set(candidateSections));
  for (const required of DEFAULT_MOBILE_HOME_CONFIG.sections) {
    if (!sections.includes(required)) sections.push(required);
  }

  return {
    schemaVersion: 1,
    page: "mobile-home",
    theme: {
      backgroundColor: color(theme.backgroundColor, DEFAULT_MOBILE_HOME_CONFIG.theme.backgroundColor),
      accentColor: color(theme.accentColor, DEFAULT_MOBILE_HOME_CONFIG.theme.accentColor),
      accentSecondary: color(theme.accentSecondary, DEFAULT_MOBILE_HOME_CONFIG.theme.accentSecondary),
      borderColor: color(theme.borderColor, DEFAULT_MOBILE_HOME_CONFIG.theme.borderColor),
      pagePadding: numberInRange(theme.pagePadding, DEFAULT_MOBILE_HOME_CONFIG.theme.pagePadding, 8, 28),
      sectionGap: numberInRange(theme.sectionGap, DEFAULT_MOBILE_HOME_CONFIG.theme.sectionGap, 4, 32),
      radius: numberInRange(theme.radius, DEFAULT_MOBILE_HOME_CONFIG.theme.radius, 8, 36),
      glowStrength: numberInRange(theme.glowStrength, DEFAULT_MOBILE_HOME_CONFIG.theme.glowStrength, 0, 1),
    },
    header: {
      logoText: text(header.logoText, DEFAULT_MOBILE_HOME_CONFIG.header.logoText, 24),
      brandAvatarUrl: imageUrl(header.brandAvatarUrl, DEFAULT_MOBILE_HOME_CONFIG.header.brandAvatarUrl),
      showBrandAvatar: bool(header.showBrandAvatar, DEFAULT_MOBILE_HOME_CONFIG.header.showBrandAvatar),
      showNotificationDot: bool(header.showNotificationDot, DEFAULT_MOBILE_HOME_CONFIG.header.showNotificationDot),
    },
    hero: {
      eyebrow: text(hero.eyebrow, DEFAULT_MOBILE_HOME_CONFIG.hero.eyebrow, 60),
      title: text(hero.title, DEFAULT_MOBILE_HOME_CONFIG.hero.title, 100),
      subtitle: text(hero.subtitle, DEFAULT_MOBILE_HOME_CONFIG.hero.subtitle, 80),
      imageUrl: imageUrl(hero.imageUrl, DEFAULT_MOBILE_HOME_CONFIG.hero.imageUrl),
      height: numberInRange(hero.height, DEFAULT_MOBILE_HOME_CONFIG.hero.height, 240, 620),
      textWidth: numberInRange(hero.textWidth, DEFAULT_MOBILE_HOME_CONFIG.hero.textWidth, 38, 75),
      contentPaddingLeft: numberInRange(hero.contentPaddingLeft, DEFAULT_MOBILE_HOME_CONFIG.hero.contentPaddingLeft, 8, 48),
      primaryLabel: text(hero.primaryLabel, DEFAULT_MOBILE_HOME_CONFIG.hero.primaryLabel, 48),
      primaryHref: route(hero.primaryHref, DEFAULT_MOBILE_HOME_CONFIG.hero.primaryHref),
      secondaryLabel: text(hero.secondaryLabel, DEFAULT_MOBILE_HOME_CONFIG.hero.secondaryLabel, 48),
      secondaryHref: route(hero.secondaryHref, DEFAULT_MOBILE_HOME_CONFIG.hero.secondaryHref),
    },
    music: {
      visible: bool(music.visible, DEFAULT_MOBILE_HOME_CONFIG.music.visible),
      coverUrl: imageUrl(music.coverUrl, DEFAULT_MOBILE_HOME_CONFIG.music.coverUrl),
      title: text(music.title, DEFAULT_MOBILE_HOME_CONFIG.music.title, 80),
      artist: text(music.artist, DEFAULT_MOBILE_HOME_CONFIG.music.artist, 60),
      currentTime: text(music.currentTime, DEFAULT_MOBILE_HOME_CONFIG.music.currentTime, 12),
      duration: text(music.duration, DEFAULT_MOBILE_HOME_CONFIG.music.duration, 12),
      progress: numberInRange(music.progress, DEFAULT_MOBILE_HOME_CONFIG.music.progress, 0, 100),
      favoriteDefault: bool(music.favoriteDefault, DEFAULT_MOBILE_HOME_CONFIG.music.favoriteDefault),
    },
    cards: {
      continue: card(cards.continue, DEFAULT_MOBILE_HOME_CONFIG.cards.continue),
      iglu: card(cards.iglu, DEFAULT_MOBILE_HOME_CONFIG.cards.iglu),
    },
    navigation: {
      homeLabel: text(navigation.homeLabel, DEFAULT_MOBILE_HOME_CONFIG.navigation.homeLabel, 18),
      avatarLabel: text(navigation.avatarLabel, DEFAULT_MOBILE_HOME_CONFIG.navigation.avatarLabel, 18),
      createLabel: text(navigation.createLabel, DEFAULT_MOBILE_HOME_CONFIG.navigation.createLabel, 18),
      marketplaceLabel: text(navigation.marketplaceLabel, DEFAULT_MOBILE_HOME_CONFIG.navigation.marketplaceLabel, 20),
    },
    sections,
  };
}

export function configCssVariables(config: MobileHomeConfig): Record<string, string> {
  const glowSize = Math.round(8 + config.theme.glowStrength * 28);
  return {
    "--lab-background": config.theme.backgroundColor,
    "--lab-accent": config.theme.accentColor,
    "--lab-accent-secondary": config.theme.accentSecondary,
    "--lab-border": config.theme.borderColor,
    "--lab-page-padding": `${config.theme.pagePadding}px`,
    "--lab-section-gap": `${config.theme.sectionGap}px`,
    "--lab-radius": `${config.theme.radius}px`,
    "--lab-glow-size": `${glowSize}px`,
    "--lab-hero-height": `${config.hero.height}px`,
    "--lab-hero-text-width": `${config.hero.textWidth}%`,
    "--lab-hero-padding-left": `${config.hero.contentPaddingLeft}px`,
    "--lab-music-progress": `${config.music.progress}%`,
  };
}
