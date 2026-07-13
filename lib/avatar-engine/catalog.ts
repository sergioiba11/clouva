import type { AvatarCategory, AvatarConfig, AvatarItem } from "./types";
import { CLOUVA_SKELETON_ID } from "./types";

const asset = (folder: string, file: string) => `/avatar-engine/${folder}/${file}`;

export const avatarCatalog: AvatarItem[] = [
  { id: "base-neutral", name: "Base CLOUVA", category: "body", modelUrl: asset("base", "base-neutral.glb"), thumbnailUrl: asset("base", "base-neutral.svg"), free: true, compatibleSkeleton: CLOUVA_SKELETON_ID, colors: ["#8D6E63", "#C58C6D", "#F1C27D"] },
  { id: "hair-messy", name: "Messy dark", category: "hair", modelUrl: asset("hair", "hair-messy.glb"), thumbnailUrl: asset("hair", "hair-messy.svg"), free: true, compatibleSkeleton: CLOUVA_SKELETON_ID, colors: ["#111111", "#3B2F2F", "#8B5CF6"] },
  { id: "hair-crop", name: "Crop clean", category: "hair", modelUrl: asset("hair", "hair-crop.glb"), thumbnailUrl: asset("hair", "hair-crop.svg"), free: true, compatibleSkeleton: CLOUVA_SKELETON_ID, colors: ["#111111", "#6B4F3A"] },
  { id: "top-hoodie-oversize", name: "Hoodie oversize", category: "top", modelUrl: asset("tops", "hoodie-oversize.glb"), thumbnailUrl: asset("tops", "hoodie-oversize.svg"), free: true, compatibleSkeleton: CLOUVA_SKELETON_ID, colors: ["#0B0B10", "#7C3AED"] },
  { id: "top-bomber", name: "Bomber night", category: "top", modelUrl: asset("tops", "bomber-night.glb"), thumbnailUrl: asset("tops", "bomber-night.svg"), free: true, compatibleSkeleton: CLOUVA_SKELETON_ID, colors: ["#111827", "#8B5CF6"] },
  { id: "bottom-baggy", name: "Baggy cargo", category: "bottom", modelUrl: asset("bottoms", "baggy-cargo.glb"), thumbnailUrl: asset("bottoms", "baggy-cargo.svg"), free: true, compatibleSkeleton: CLOUVA_SKELETON_ID, colors: ["#111111", "#2D2A32"] },
  { id: "bottom-jogger", name: "Jogger tech", category: "bottom", modelUrl: asset("bottoms", "jogger-tech.glb"), thumbnailUrl: asset("bottoms", "jogger-tech.svg"), free: true, compatibleSkeleton: CLOUVA_SKELETON_ID, colors: ["#0F172A", "#1F2937"] },
  { id: "shoes-runner", name: "Runner glow", category: "shoes", modelUrl: asset("shoes", "runner-glow.glb"), thumbnailUrl: asset("shoes", "runner-glow.svg"), free: true, compatibleSkeleton: CLOUVA_SKELETON_ID, colors: ["#F5F3FF", "#8B5CF6"] },
  { id: "shoes-classic", name: "Classic black", category: "shoes", modelUrl: asset("shoes", "classic-black.glb"), thumbnailUrl: asset("shoes", "classic-black.svg"), free: true, compatibleSkeleton: CLOUVA_SKELETON_ID, colors: ["#050505", "#F5F3FF"] },
  { id: "acc-shades", name: "Lentes shade", category: "accessory", modelUrl: asset("accessories", "shades.glb"), thumbnailUrl: asset("accessories", "shades.svg"), free: true, compatibleSkeleton: CLOUVA_SKELETON_ID, colors: ["#050505"] },
  { id: "acc-violet-chain", name: "Cadena violet", category: "accessory", modelUrl: asset("accessories", "violet-chain.glb"), thumbnailUrl: asset("accessories", "violet-chain.svg"), free: true, compatibleSkeleton: CLOUVA_SKELETON_ID, colors: ["#8B5CF6"] },
];

export const avatarCategories: { id: Exclude<AvatarCategory, "body">; label: string }[] = [
  { id: "hair", label: "Pelo" },
  { id: "top", label: "Parte superior" },
  { id: "bottom", label: "Pantalón" },
  { id: "shoes", label: "Zapatillas" },
  { id: "accessory", label: "Accesorios" },
];

export const defaultAvatarConfig: AvatarConfig = {
  bodyId: "base-neutral",
  hairId: "hair-messy",
  topId: "top-hoodie-oversize",
  bottomId: "bottom-baggy",
  shoesId: "shoes-runner",
  accessoryIds: ["acc-violet-chain"],
  skinTone: "#C58C6D",
  hairColor: "#111111",
  materialColors: { top: "#0B0B10", bottom: "#111111", shoes: "#F5F3FF", glow: "#8B5CF6" },
  morphValues: {},
};

export function getAvatarItemsByCategory(category: AvatarCategory) {
  return avatarCatalog.filter((item) => item.category === category);
}

export function getAvatarItem(id: string | null) {
  return id ? avatarCatalog.find((item) => item.id === id) ?? null : null;
}

export function generateAvatarConfig(prompt: string): AvatarConfig {
  const text = prompt.toLowerCase();
  return {
    ...defaultAvatarConfig,
    hairId: text.includes("desorden") || text.includes("messy") ? "hair-messy" : "hair-crop",
    topId: text.includes("hoodie") || text.includes("oversize") ? "top-hoodie-oversize" : "top-bomber",
    bottomId: text.includes("baggy") || text.includes("cargo") ? "bottom-baggy" : "bottom-jogger",
    shoesId: text.includes("classic") ? "shoes-classic" : "shoes-runner",
    accessoryIds: text.includes("lentes") ? ["acc-shades", "acc-violet-chain"] : ["acc-violet-chain"],
    materialColors: { ...defaultAvatarConfig.materialColors, top: text.includes("violeta") ? "#2A124A" : "#0B0B10", glow: "#8B5CF6" },
  };
}
