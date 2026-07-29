import type { InstagramProfile } from "./types";

const RESERVED_SLUGS = new Set([
  "login", "registro", "auth", "admin", "api", "matrix", "players", "studios",
  "profile", "onboarding", "creator-studio", "avatar", "catalogo", "biblioteca",
  "tienda", "mundos", "settings", "vip", "checkout", "legal", "support", "webhooks",
]);

export function normalizePublicSlug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function proposePlayerSlug(username?: string, name?: string) {
  const base = normalizePublicSlug(username || name || "player") || "player";
  return RESERVED_SLUGS.has(base) ? `${base}-player` : base;
}

export function mapInstagramProfileToDraft(profile: InstagramProfile) {
  const username = profile.username?.replace(/^@/, "").trim() || null;
  return {
    display_name: profile.name?.trim() || username || "Player",
    username,
    slug: proposePlayerSlug(username || undefined, profile.name),
    short_bio: profile.biography?.trim() || null,
    profile_image_url: profile.profile_picture_url || null,
    social_links: username
      ? [{ platform: "instagram", label: `@${username}`, username, url: `https://instagram.com/${username}`, is_visible: true, display_order: 0 }]
      : [],
  };
}
