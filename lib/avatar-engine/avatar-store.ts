"use client";

import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { avatarCatalog, defaultAvatarConfig, getAvatarItem } from "./catalog";
import type { AvatarCategory, AvatarConfig } from "./types";

type AvatarState = {
  config: AvatarConfig;
  saving: boolean;
  error: string | null;
  setItem: (category: AvatarCategory, itemId: string) => void;
  toggleAccessory: (itemId: string) => void;
  applyConfig: (config: AvatarConfig) => void;
  saveActiveAvatar: () => Promise<void>;
};

export const useAvatarStore = create<AvatarState>((set, get) => ({
  config: defaultAvatarConfig,
  saving: false,
  error: null,
  setItem: (category, itemId) => set(({ config }) => {
    const item = getAvatarItem(itemId);
    if (!item || item.category !== category) return { config };
    if (category === "body") return { config: { ...config, bodyId: itemId } };
    if (category === "hair") return { config: { ...config, hairId: itemId } };
    if (category === "top") return { config: { ...config, topId: itemId } };
    if (category === "bottom") return { config: { ...config, bottomId: itemId } };
    if (category === "shoes") return { config: { ...config, shoesId: itemId } };
    return { config };
  }),
  toggleAccessory: (itemId) => set(({ config }) => ({
    config: {
      ...config,
      accessoryIds: config.accessoryIds.includes(itemId)
        ? config.accessoryIds.filter((id) => id !== itemId)
        : [...config.accessoryIds, itemId],
    },
  })),
  applyConfig: (config) => set({ config }),
  saveActiveAvatar: async () => {
    set({ saving: true, error: null });
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) {
      set({ saving: false, error: "Iniciá sesión para guardar tu avatar." });
      return;
    }
    const { error } = await supabase.from("user_avatars").upsert({
      user_id: auth.user.id,
      config: get().config,
      is_active: true,
      updated_at: new Date().toISOString(),
    });
    set({ saving: false, error: error?.message ?? null });
  },
}));

export function selectedAvatarItems(config: AvatarConfig) {
  return [config.bodyId, config.hairId, config.topId, config.bottomId, config.shoesId, ...config.accessoryIds]
    .map(getAvatarItem)
    .filter((item): item is (typeof avatarCatalog)[number] => Boolean(item));
}
