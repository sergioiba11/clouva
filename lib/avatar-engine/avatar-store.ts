"use client";

import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { avatarCatalog, defaultAvatarConfig, getAvatarItem, loadAvatarCatalog } from "./catalog";
import { loadAvatarConfig, sanitizeAvatarConfig, saveAvatarConfig } from "./apply-avatar-config";
import type { AvatarCategory, AvatarConfig } from "./types";

type AvatarState = { config: AvatarConfig; catalogReady: boolean; saving: boolean; error: string | null; notice: string | null; hydrate: () => Promise<void>; setItem: (category: AvatarCategory, itemId: string) => void; toggleAccessory: (itemId: string) => void; applyConfig: (config: AvatarConfig, notice?: string) => void; saveActiveAvatar: () => Promise<void>; };
const persist = (config: AvatarConfig) => saveAvatarConfig(config);

export const useAvatarStore = create<AvatarState>((set, get) => ({
  config: defaultAvatarConfig, catalogReady: false, saving: false, error: null, notice: null,
  hydrate: async () => {
    await loadAvatarCatalog(); let config = loadAvatarConfig();
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) { const { data } = await supabase.from("user_avatars").select("config").eq("user_id", auth.user.id).eq("is_active", true).maybeSingle(); if (data?.config) config = data.config as AvatarConfig; }
    set({ config: sanitizeAvatarConfig(config), catalogReady: true });
  },
  setItem: (category, itemId) => set(({ config }) => {
    const item = getAvatarItem(itemId); if (!item || item.category !== category) return { config, notice: "Ese asset todavía no está disponible." };
    const next = { ...config };
    if (category === "body") next.bodyId = itemId; else if (category === "face") next.faceId = itemId; else if (category === "hair") next.hairId = itemId; else if (category === "top") next.topId = itemId; else if (category === "bottom") next.bottomId = itemId; else if (category === "shoes") next.shoesId = itemId;
    persist(next); return { config: next, notice: null };
  }),
  toggleAccessory: (itemId) => set(({ config }) => { const item = getAvatarItem(itemId); if (!item || item.category !== "accessory") return { config, notice: "Accesorio no disponible." }; const next = { ...config, accessoryIds: config.accessoryIds.includes(itemId) ? config.accessoryIds.filter((id) => id !== itemId) : [...config.accessoryIds, itemId] }; persist(next); return { config: next }; }),
  applyConfig: (config, notice) => { const next = sanitizeAvatarConfig(config); persist(next); set({ config: next, notice: notice ?? null }); },
  saveActiveAvatar: async () => {
    set({ saving: true, error: null }); const config = sanitizeAvatarConfig(get().config); persist(config);
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) { set({ saving: false, error: null, notice: "Guardado localmente en este dispositivo." }); return; }
    const { error } = await supabase.from("user_avatars").upsert({ user_id: auth.user.id, config, is_active: true, updated_at: new Date().toISOString() });
    set({ saving: false, error: error?.message ?? null });
  },
}));

export function selectedAvatarItems(config: AvatarConfig) { return [config.bodyId, config.faceId, config.hairId, config.topId, config.bottomId, config.shoesId, ...config.accessoryIds].map(getAvatarItem).filter((item): item is (typeof avatarCatalog)[number] => Boolean(item)); }
