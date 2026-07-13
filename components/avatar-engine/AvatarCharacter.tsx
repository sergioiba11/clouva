"use client";

import { getAvatarItem } from "@/lib/avatar-engine/catalog";
import type { AvatarConfig } from "@/lib/avatar-engine/types";
import { AvatarPart } from "./AvatarPart";

export function AvatarCharacter({ config }: { config: AvatarConfig }) {
  const body = getAvatarItem(config.bodyId);
  const parts = [config.hairId, config.topId, config.bottomId, config.shoesId, ...config.accessoryIds]
    .map(getAvatarItem)
    .filter((part): part is NonNullable<ReturnType<typeof getAvatarItem>> => Boolean(part));

  return (
    <div className="avatar-character" aria-label="Placeholder funcional del avatar 3D modular CLOUVA">
      <div className="avatar-character-rig" data-skeleton={body?.compatibleSkeleton}>
        <span className="avatar-shadow" />
        <span className="avatar-body" style={{ background: config.skinTone }} />
        <span className="avatar-head" style={{ background: config.skinTone }} />
        {parts.map((part) => (
          <AvatarPart
            key={part.id}
            item={part}
            color={part.category === "hair" ? config.hairColor : config.materialColors[part.category] ?? part.colors?.[0]}
          />
        ))}
      </div>
      <p className="avatar-engine-disclaimer">Preview placeholder: reemplazar por GLB riggeados en producción.</p>
    </div>
  );
}
