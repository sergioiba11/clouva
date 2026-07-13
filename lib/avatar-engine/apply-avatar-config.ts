import { avatarCatalog, getAvatarItem } from "./catalog";
import { loadAvatarPart } from "./load-avatar-part";
import type { AvatarConfig } from "./types";

export async function applyAvatarConfig(config: AvatarConfig) {
  const body = getAvatarItem(config.bodyId) ?? avatarCatalog[0];
  const ids = [config.hairId, config.topId, config.bottomId, config.shoesId, ...config.accessoryIds].filter(Boolean) as string[];
  const loaded = await Promise.all(ids.map((id) => {
    const item = getAvatarItem(id);
    if (!item) return null;
    return loadAvatarPart(item, body.compatibleSkeleton);
  }));

  return {
    body,
    activeParts: loaded.filter(Boolean),
    materialColors: config.materialColors,
    morphValues: config.morphValues,
  };
}
