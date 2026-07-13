import { avatarCatalog, defaultAvatarConfig, getAvatarItem } from "./catalog";
import { applyMaterialColors, applyMorphValues, loadAvatarPart, setHairColor, setSkinTone, validateAvatarItemCompatibility } from "./load-avatar-part";
import type { AvatarConfig, BaseAvatarModel } from "./types";

export function sanitizeAvatarConfig(config: AvatarConfig): AvatarConfig {
  const keep = (id: string | null | undefined, category: string) => { const item = getAvatarItem(id); return item?.category === category ? item.id : null; };
  return { ...defaultAvatarConfig, ...config, bodyId: keep(config.bodyId, "body") ?? avatarCatalog.find((item) => item.category === "body")?.id ?? defaultAvatarConfig.bodyId, faceId: keep(config.faceId, "face"), hairId: keep(config.hairId, "hair"), topId: keep(config.topId, "top"), bottomId: keep(config.bottomId, "bottom"), shoesId: keep(config.shoesId, "shoes"), accessoryIds: (config.accessoryIds ?? []).filter((id) => getAvatarItem(id)?.category === "accessory") };
}

export async function applyAvatarConfig(config: AvatarConfig, baseModel?: BaseAvatarModel | null) {
  const safe = sanitizeAvatarConfig(config);
  const body = getAvatarItem(safe.bodyId) ?? avatarCatalog.find((item) => item.category === "body");
  const ids = [safe.faceId, safe.hairId, safe.topId, safe.bottomId, safe.shoesId, ...safe.accessoryIds].filter(Boolean) as string[];
  const activeParts = [];
  const errors: Record<string, string> = {};
  for (const id of ids) {
    const item = getAvatarItem(id); if (!item) { errors[id] = "Item inexistente"; continue; }
    const compatible = validateAvatarItemCompatibility(item, baseModel);
    if (!compatible.compatible) { errors[id] = compatible.reasons.join("; "); continue; }
    try { activeParts.push(await loadAvatarPart(item, baseModel)); } catch (error) { errors[id] = error instanceof Error ? error.message : "No se pudo cargar"; }
  }
  if (baseModel?.object) {
    applyMaterialColors(baseModel.object, safe.materialColors); setSkinTone(baseModel.object, safe.skinTone); setHairColor(baseModel.object, safe.hairColor); applyMorphValues(baseModel.object, safe.morphValues);
  }
  return { body, activeParts, materialColors: safe.materialColors, morphValues: safe.morphValues, activeAnimation: safe.activeAnimation, errors };
}

export const getCurrentAvatarConfig = (config: AvatarConfig) => sanitizeAvatarConfig(config);
export const resetAvatarConfig = () => defaultAvatarConfig;
export function saveAvatarConfig(config: AvatarConfig) { if (typeof window !== "undefined") localStorage.setItem("clouva.avatar.config", JSON.stringify(sanitizeAvatarConfig(config))); }
export function loadAvatarConfig(): AvatarConfig { if (typeof window === "undefined") return defaultAvatarConfig; try { return sanitizeAvatarConfig(JSON.parse(localStorage.getItem("clouva.avatar.config") || "null") ?? defaultAvatarConfig); } catch { return defaultAvatarConfig; } }
