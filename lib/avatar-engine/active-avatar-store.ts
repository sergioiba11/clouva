"use client";

import { create } from "zustand";

export type ActiveAvatarSource = "official" | "generated" | "uploaded" | "fallback";
export type ActiveAvatarStatus = "idle" | "generating" | "processing" | "ready" | "error";

export type ActiveAvatar = {
  id: string;
  source: ActiveAvatarSource;
  modelUrl: string | null;
  fallbackUrl: string | null;
  status: ActiveAvatarStatus;
  frontRotationY: number;
  updatedAt: string;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
export const OFFICIAL_CLOUVA_MODEL_URL = supabaseUrl
  ? `${supabaseUrl}/storage/v1/object/public/avatars/official/clouva-official-v1.glb`
  : "/models/clouva/clouva-official-v1.glb";

export const TEMPORARY_RIG_URL = "/models/base-body.glb";

export const OFFICIAL_CLOUVA_AVATAR: ActiveAvatar = {
  id: "clouva-official-v1",
  source: "official",
  modelUrl: OFFICIAL_CLOUVA_MODEL_URL,
  fallbackUrl: null,
  status: "ready",
  frontRotationY: 0,
  updatedAt: "2026-07-13T00:00:00.000Z",
};

type ActiveAvatarStore = {
  avatar: ActiveAvatar;
  hydratedUserId: string | null;
  loading: boolean;
  setActiveAvatar: (avatar: ActiveAvatar) => void;
  useOfficialAvatar: () => void;
  setStatus: (status: ActiveAvatarStatus) => void;
  loadActiveAvatar: (userId?: string | null) => Promise<void>;
};

export const useActiveAvatarStore = create<ActiveAvatarStore>((set, get) => ({
  avatar: OFFICIAL_CLOUVA_AVATAR,
  hydratedUserId: null,
  loading: false,
  setActiveAvatar: (avatar) => set({ avatar }),
  useOfficialAvatar: () => set({ avatar: OFFICIAL_CLOUVA_AVATAR }),
  setStatus: (status) => set((state) => ({ avatar: { ...state.avatar, status } })),
  loadActiveAvatar: async (userId) => {
    if (!userId) {
      set({ avatar: OFFICIAL_CLOUVA_AVATAR, hydratedUserId: null, loading: false });
      return;
    }
    if (get().loading || get().hydratedUserId === userId) return;

    set({ loading: true });
    try {
      const { supabase } = await import("@/lib/supabase");
      const { data, error } = await supabase
        .from("user_avatars")
        .select("id,source,status,model_url,front_rotation_y,updated_at")
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!data?.model_url || data.status !== "ready") {
        set({ avatar: OFFICIAL_CLOUVA_AVATAR, hydratedUserId: userId, loading: false });
        return;
      }

      set({
        avatar: {
          id: data.id,
          source: data.source === "uploaded" ? "uploaded" : "generated",
          modelUrl: data.model_url,
          fallbackUrl: null,
          status: "ready",
          frontRotationY: Number(data.front_rotation_y ?? 0),
          updatedAt: data.updated_at ?? new Date().toISOString(),
        },
        hydratedUserId: userId,
        loading: false,
      });
    } catch (error) {
      console.error("Could not load active avatar", error);
      set({ avatar: OFFICIAL_CLOUVA_AVATAR, hydratedUserId: userId, loading: false });
    }
  },
}));
