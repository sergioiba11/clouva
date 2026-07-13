import type { AvatarCategory, AvatarConfig, AvatarItem } from "./types";
import { CLOUVA_SKELETON_ID } from "./types";

const envUrl = (value: string | undefined) => value?.trim() || null;

export const avatarAssetUrls = {
  base: envUrl(process.env.NEXT_PUBLIC_AVATAR_BASE_URL),
  hair: envUrl(process.env.NEXT_PUBLIC_AVATAR_HAIR_URL),
  top: envUrl(process.env.NEXT_PUBLIC_AVATAR_TOP_URL),
  bottom: envUrl(process.env.NEXT_PUBLIC_AVATAR_BOTTOM_URL),
  shoes: envUrl(process.env.NEXT_PUBLIC_AVATAR_SHOES_URL),
};

export const avatarDemoMode = process.env.NEXT_PUBLIC_AVATAR_DEMO_MODE === "true";

const item = (id: string, name: string, category: AvatarCategory, modelUrl: string | null, thumbnailUrl: string, colors: string[]): AvatarItem | null => {
  if (!modelUrl) return null;
  return { id, name, category, modelUrl, thumbnailUrl, free: true, compatibleSkeleton: CLOUVA_SKELETON_ID, colors };
};

export const avatarCatalog: AvatarItem[] = [
  item("base-remote", "Humanoide CLOUVA", "body", avatarAssetUrls.base, "/avatar-engine/base/remote.svg", ["#8D6E63", "#C58C6D", "#F1C27D"]),
  ...(avatarDemoMode ? [] : [
    item("hair-remote", "Pelo remoto", "hair", avatarAssetUrls.hair, "/avatar-engine/hair/remote.svg", ["#111111", "#3B2F2F", "#8B5CF6"]),
    item("top-remote", "Top remoto", "top", avatarAssetUrls.top, "/avatar-engine/tops/remote.svg", ["#0B0B10", "#7C3AED"]),
    item("bottom-remote", "Bottom remoto", "bottom", avatarAssetUrls.bottom, "/avatar-engine/bottoms/remote.svg", ["#111111", "#2D2A32"]),
    item("shoes-remote", "Zapatillas remotas", "shoes", avatarAssetUrls.shoes, "/avatar-engine/shoes/remote.svg", ["#F5F3FF", "#8B5CF6"]),
  ]),
].filter((entry): entry is AvatarItem => Boolean(entry));

export const avatarCategories: { id: Exclude<AvatarCategory, "body">; label: string }[] = [
  { id: "hair", label: "Pelo" },
  { id: "top", label: "Parte superior" },
  { id: "bottom", label: "Pantalón" },
  { id: "shoes", label: "Zapatillas" },
  { id: "accessory", label: "Accesorios" },
  { id: "color", label: "Colores" },
  { id: "animation", label: "Animaciones" },
];

const firstByCategory = (category: AvatarCategory) => avatarCatalog.find((entry) => entry.category === category)?.id ?? null;

export const defaultAvatarConfig: AvatarConfig = {
  bodyId: firstByCategory("body") ?? "base-remote",
  hairId: avatarDemoMode ? null : firstByCategory("hair"),
  topId: avatarDemoMode ? null : firstByCategory("top"),
  bottomId: avatarDemoMode ? null : firstByCategory("bottom"),
  shoesId: avatarDemoMode ? null : firstByCategory("shoes"),
  accessoryIds: [],
  skinTone: "#C58C6D",
  hairColor: "#111111",
  materialColors: { top: "#0B0B10", bottom: "#111111", shoes: "#F5F3FF", glow: "#8B5CF6" },
  morphValues: {},
};

export function getAvatarItemsByCategory(category: AvatarCategory) {
  return avatarCatalog.filter((entry) => entry.category === category);
}

export function hasAvatarAssetsForCategory(category: AvatarCategory) {
  return getAvatarItemsByCategory(category).length > 0;
}

export function getAvatarItem(id: string | null) {
  return id ? avatarCatalog.find((entry) => entry.id === id) ?? null : null;
}

export function getRenderableAvatarUrl(config: AvatarConfig = defaultAvatarConfig) {
  return getAvatarItem(config.bodyId)?.modelUrl ?? avatarAssetUrls.base;
}

export function generateAvatarConfig(prompt: string): AvatarConfig {
  const text = prompt.toLowerCase();
  const next: AvatarConfig = { ...defaultAvatarConfig, accessoryIds: [] };
  const availableHair = getAvatarItemsByCategory("hair");
  const availableTops = getAvatarItemsByCategory("top");
  const availableBottoms = getAvatarItemsByCategory("bottom");
  const availableShoes = getAvatarItemsByCategory("shoes");

  next.hairId = availableHair[0]?.id ?? null;
  next.topId = availableTops[0]?.id ?? null;
  next.bottomId = availableBottoms[0]?.id ?? null;
  next.shoesId = availableShoes[0]?.id ?? null;
  next.materialColors = { ...defaultAvatarConfig.materialColors, top: text.includes("violeta") ? "#2A124A" : "#0B0B10", glow: "#8B5CF6" };

  return next;
}
