"use client";

import { Sparkles, Save } from "lucide-react";
import { generateAvatarConfig, getAvatarItemsByCategory } from "@/lib/avatar-engine/catalog";
import { useAvatarStore } from "@/lib/avatar-engine/avatar-store";
import type { AvatarCategory } from "@/lib/avatar-engine/types";
import { AvatarCategoryTray } from "./AvatarCategoryTray";
import { AvatarItemThumbnail } from "./AvatarItemThumbnail";

export function AvatarControls({ active, onActiveChange }: { active: Exclude<AvatarCategory, "body">; onActiveChange: (category: Exclude<AvatarCategory, "body">) => void }) {
  const { config, setItem, toggleAccessory, applyConfig, saveActiveAvatar, saving, error } = useAvatarStore();
  const items = getAvatarItemsByCategory(active);
  const isSelected = (id: string) => active === "accessory" ? config.accessoryIds.includes(id) : config[`${active}Id` as "hairId" | "topId" | "bottomId" | "shoesId"] === id;

  return (
    <section className="avatar-engine-locker" aria-label="Locker del avatar">
      <div className="avatar-engine-actions">
        <button type="button" onClick={() => applyConfig(generateAvatarConfig("streetwear oscuro hoodie oversize pantalón baggy pelo desordenado detalles violetas"))}><Sparkles className="h-4 w-4" /> Clover AI mock</button>
        <button type="button" onClick={saveActiveAvatar} disabled={saving}><Save className="h-4 w-4" /> {saving ? "Guardando…" : "Guardar"}</button>
      </div>
      {error ? <p className="avatar-save-error">{error}</p> : null}
      <AvatarCategoryTray active={active} onChange={onActiveChange} />
      <div className="avatar-thumb-row">{items.map((item) => <AvatarItemThumbnail key={item.id} item={item} selected={isSelected(item.id)} onSelect={() => active === "accessory" ? toggleAccessory(item.id) : setItem(active, item.id)} />)}</div>
    </section>
  );
}
