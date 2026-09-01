export const SOCIAL_PLATFORM_DEFINITIONS = {
  instagram: { label: "Instagram", icon: "instagram" },
  spotify: { label: "Spotify", icon: "spotify" },
  youtube: { label: "YouTube", icon: "youtube" },
  soundcloud: { label: "SoundCloud", icon: "soundcloud" },
  x: { label: "X", icon: "x" },
  facebook: { label: "Facebook", icon: "facebook" },
  tiktok: { label: "TikTok", icon: "tiktok" },
  apple_music: { label: "Apple Music", icon: "apple_music" },
  website: { label: "Sitio web", icon: "website" },
  contact: { label: "Contacto", icon: "contact" },
} as const;

export type CanonicalSocialPlatform = keyof typeof SOCIAL_PLATFORM_DEFINITIONS;
export type SocialIconKey = (typeof SOCIAL_PLATFORM_DEFINITIONS)[CanonicalSocialPlatform]["icon"];

const PLATFORM_ALIASES: Record<string, CanonicalSocialPlatform> = {
  twitter: "x",
  xcom: "x",
  apple: "apple_music",
  applemusic: "apple_music",
  web: "website",
  email: "contact",
};

export function normalizeSocialPlatform(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  const normalized = raw.replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
  if (!normalized) return "website";
  return PLATFORM_ALIASES[normalized] || normalized;
}

export function isCanonicalSocialPlatform(value: string): value is CanonicalSocialPlatform {
  return Object.prototype.hasOwnProperty.call(SOCIAL_PLATFORM_DEFINITIONS, value);
}

export function getSocialPlatformDefinition(value: unknown) {
  const platform = normalizeSocialPlatform(value);
  if (isCanonicalSocialPlatform(platform)) return { platform, ...SOCIAL_PLATFORM_DEFINITIONS[platform] };
  return {
    platform,
    label: platform.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()) || "Link",
    icon: "website" as SocialIconKey,
  };
}

export function normalizeSocialUsername(value: unknown) {
  if (typeof value !== "string") return "";
  const username = value.trim().replace(/^@+/, "");
  return username ? `@${username}` : "";
}

export function sanitizeSocialUrl(value: unknown, platformValue?: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > 2048) return null;
  const platform = normalizeSocialPlatform(platformValue);

  if (platform === "contact" && /^mailto:/i.test(candidate)) {
    const address = candidate.slice(7).trim();
    if (!address || /[\r\n]/.test(address)) return null;
    return `mailto:${address}`;
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return null;
  }
}

export const SOCIAL_EDITOR_PLATFORMS: Array<{ value: CanonicalSocialPlatform; label: string }> = [
  { value: "instagram", label: "Instagram" },
  { value: "spotify", label: "Spotify" },
  { value: "youtube", label: "YouTube" },
  { value: "soundcloud", label: "SoundCloud" },
  { value: "x", label: "X / Twitter" },
  { value: "facebook", label: "Facebook" },
  { value: "tiktok", label: "TikTok" },
  { value: "apple_music", label: "Apple Music" },
  { value: "website", label: "Sitio web" },
  { value: "contact", label: "Contacto" },
];
