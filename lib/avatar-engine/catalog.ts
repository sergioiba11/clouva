import { supabase } from "@/lib/supabase";
import { resolveAvatarAssetUrl } from "./assets";
import type { AvatarCategory, AvatarConfig, AvatarItem } from "./types";
import { CLOUVA_SKELETON_ID } from "./types";

const envUrl = (value: string | undefined) => value?.trim() || null;
export const avatarAssetUrls = { base: envUrl(process.env.NEXT_PUBLIC_AVATAR_BASE_URL) };
export const avatarDemoMode = process.env.NEXT_PUBLIC_AVATAR_DEMO_MODE === "true";
const ready = (item: AvatarItem) => (item.status ?? "ready") === "ready" && Boolean(resolveAvatarAssetUrl(item));

const mock = (id: string, name: string, category: AvatarCategory, modelUrl: string | null, thumbnailUrl: string, colors: string[] = []): AvatarItem | null => modelUrl ? ({ id, name, category, modelUrl, thumbnailUrl, previewImage: thumbnailUrl, free: true, compatibleSkeleton: CLOUVA_SKELETON_ID, skeletonId: CLOUVA_SKELETON_ID, status: "ready", colors, tags: [], materialNames: [], supportedMorphs: [], supportedAnimations: ["idle"], version: "mock-env" }) : null;

export const mockAvatarCatalog: AvatarItem[] = [mock("base-remote", "Humanoide CLOUVA", "body", avatarAssetUrls.base, "/avatar-engine/base/remote.svg", ["#8D6E63", "#C58C6D", "#F1C27D"])].filter((entry): entry is AvatarItem => Boolean(entry));
export let avatarCatalog: AvatarItem[] = mockAvatarCatalog.filter(ready);

export const avatarCategories: { id: Exclude<AvatarCategory, "body">; label: string }[] = [
  { id: "hair", label: "Pelo" }, { id: "top", label: "Parte superior" }, { id: "bottom", label: "Pantalón" }, { id: "shoes", label: "Zapatillas" }, { id: "accessory", label: "Accesorios" }, { id: "color", label: "Colores" }, { id: "animation", label: "Animaciones" },
];

const firstByCategory = (category: AvatarCategory) => avatarCatalog.find((entry) => entry.category === category)?.id ?? null;
export const defaultAvatarConfig: AvatarConfig = { bodyId: firstByCategory("body") ?? "base-remote", faceId: null, hairId: null, topId: null, bottomId: null, shoesId: null, accessoryIds: [], skinTone: "#C58C6D", hairColor: "#111111", materialColors: {}, morphValues: {}, activeAnimation: "idle" };

function fromRow(row: any): AvatarItem {
  const meta = (row.metadata ?? {}) as Record<string, any>;
  return { id: row.id, name: row.name, category: row.category, modelUrl: row.model_url ?? meta.modelUrl ?? null, thumbnailUrl: row.thumbnail_url ?? null, previewImage: meta.previewImage ?? row.thumbnail_url ?? null, free: row.free ?? true, compatibleSkeleton: row.compatible_skeleton ?? meta.skeletonId ?? CLOUVA_SKELETON_ID, skeletonId: meta.skeletonId ?? row.compatible_skeleton ?? CLOUVA_SKELETON_ID, status: meta.status ?? row.status ?? "ready", colors: meta.colors ?? [], tags: meta.tags ?? [], materialNames: meta.materialNames ?? [], supportedMorphs: meta.supportedMorphs ?? [], supportedAnimations: meta.supportedAnimations ?? [], version: meta.version, metadata: meta };
}

export async function loadAvatarCatalog() {
  try {
    const { data, error } = await supabase.from("avatar_items").select("*");
    if (error) throw error;
    const remote = (data ?? []).map(fromRow).filter(ready);
    avatarCatalog = remote.length ? remote : mockAvatarCatalog.filter(ready);
  } catch (error) {
    if (process.env.NODE_ENV === "development") console.warn("Using avatar mock catalog fallback", error);
    avatarCatalog = mockAvatarCatalog.filter(ready);
  }
  return avatarCatalog;
}

export function getAvatarItemsByCategory(category: AvatarCategory) { return avatarCatalog.filter((entry) => entry.category === category && ready(entry)); }
export function hasAvatarAssetsForCategory(category: AvatarCategory) { return getAvatarItemsByCategory(category).length > 0; }
export function getAvatarItem(id: string | null | undefined) { return id ? avatarCatalog.find((entry) => entry.id === id && ready(entry)) ?? null : null; }
export function getRenderableAvatarUrl(config: AvatarConfig = defaultAvatarConfig) { return resolveAvatarAssetUrl(getAvatarItem(config.bodyId)) ?? avatarAssetUrls.base; }

export function generateAvatarConfig(prompt: string, current: AvatarConfig = defaultAvatarConfig): AvatarConfig {
  const text = prompt.toLowerCase(); const next: AvatarConfig = { ...current, materialColors: { ...current.materialColors }, morphValues: { ...current.morphValues }, accessoryIds: [...current.accessoryIds] };
  const pick = (category: AvatarCategory, words: string[]) => getAvatarItemsByCategory(category).find((item) => words.some((word) => `${item.name} ${item.tags?.join(" ")}`.toLowerCase().includes(word)));
  const hair = pick("hair", ["pelo", "hair", "desordenado"]); if (hair) next.hairId = hair.id;
  const top = pick("top", ["hoodie", "buzo", "top", "remera"]); if (top) next.topId = top.id;
  const bottom = pick("bottom", ["baggy", "pantalón", "bottom"]); if (bottom) next.bottomId = bottom.id;
  const shoes = pick("shoes", ["zapat", "shoes"]); if (shoes) next.shoesId = shoes.id;
  const violet = text.includes("violeta") || text.includes("purple"); if (violet) next.materialColors = { ...next.materialColors, Hoodie_Accent: "#7C3AED", Hair_Main: next.hairColor };
  if (text.includes("oscuro") || text.includes("dark")) next.materialColors = { ...next.materialColors, Hoodie_Main: "#080808" };
  return next;
}
