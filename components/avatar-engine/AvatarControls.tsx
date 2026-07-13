"use client";

import { useState } from "react";
import { Clover, Save, Send } from "lucide-react";
import { generateAvatarConfig, getAvatarItemsByCategory } from "@/lib/avatar-engine/catalog";
import { useAvatarStore } from "@/lib/avatar-engine/avatar-store";
import type { AvatarCategory } from "@/lib/avatar-engine/types";
import { AvatarCategoryTray } from "./AvatarCategoryTray";
import { AvatarItemThumbnail } from "./AvatarItemThumbnail";

export function AvatarControls({ active, onActiveChange }: { active: Exclude<AvatarCategory, "body">; onActiveChange: (category: Exclude<AvatarCategory, "body">) => void }) {
  const [aiOpen, setAiOpen] = useState(false);
  const [prompt, setPrompt] = useState("Quiero un personaje streetwear oscuro, hoodie oversize, pantalón baggy, pelo desordenado y detalles violetas.");
  const { config, setItem, toggleAccessory, applyConfig, saveActiveAvatar, saving, error, notice } = useAvatarStore();
  const items = getAvatarItemsByCategory(active);
  const isSelected = (id: string) => active === "accessory" ? config.accessoryIds.includes(id) : config[`${active}Id` as "hairId" | "topId" | "bottomId" | "shoesId"] === id;
  const runClover = () => applyConfig(generateAvatarConfig(prompt, config), "Clover aplicó solo assets reales disponibles.");

  return (
    <section className="avatar-engine-locker" aria-label="Locker del avatar">
      <div className="avatar-engine-actions">
        <button type="button" className="avatar-clover-mini" onClick={() => setAiOpen((value) => !value)}><Clover className="h-4 w-4" /> Clover AI</button>
        <button type="button" onClick={saveActiveAvatar} disabled={saving}><Save className="h-4 w-4" /> {saving ? "Guardando…" : "Guardar"}</button>
      </div>
      {aiOpen ? <div className="avatar-ai-compose"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} /><button type="button" onClick={runClover}><Send className="h-4 w-4" /> Aplicar estilo</button></div> : null}
      {error ? <p className="avatar-save-error">No pudimos guardar ahora. Revisá tu sesión.</p> : null}
      {notice ? <p className="avatar-save-error">{notice}</p> : null}
      <AvatarCategoryTray active={active} onChange={onActiveChange} />
      <div className="avatar-thumb-row">{items.length ? items.map((item) => <AvatarItemThumbnail key={item.id} item={item} selected={isSelected(item.id)} onSelect={() => active === "accessory" ? toggleAccessory(item.id) : setItem(active, item.id)} />) : <span className="avatar-engine-empty">Próximamente</span>}</div>
    </section>
  );
}
