"use client";

import type { AvatarItem } from "@/lib/avatar-engine/types";

export function AvatarItemThumbnail({ item, selected, onSelect }: { item: AvatarItem; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`avatar-item-thumb ${selected ? "active" : ""}`} onClick={onSelect} aria-pressed={selected}>
      <span className="avatar-thumb-art" style={{ background: `radial-gradient(circle at 50% 25%, ${item.colors?.[1] ?? "#8B5CF6"}, transparent 34%), linear-gradient(145deg, ${item.colors?.[0] ?? "#16151f"}, #050505)` }} />
      <span>{item.name}</span>
      <small>{item.free ? "Free" : "Drop"}</small>
    </button>
  );
}
