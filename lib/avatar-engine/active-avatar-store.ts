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

const mapAvatar = (data: any): ActiveAvatar => ({
  id: data.id,
  source: data.source === "uploaded" ? "uploaded" : "generated",
  modelUrl: data.model_url,
  fallbackUrl: null,
  status: "ready",
  frontRotationY: Number(data.front_rotation_y ?? 0),
  updatedAt: data.updated_at ?? new Date().toISOString(),
});

const mapProfileAvatar = (userId: string, modelUrl: string, updatedAt?: string | null): ActiveAvatar => ({
  id: `official-rigged-${userId}`,
  source: "official",
  modelUrl,
  fallbackUrl: OFFICIAL_CLOUVA_MODEL_URL,
  status: "ready",
  frontRotationY: 0,
  updatedAt: updatedAt ?? new Date().toISOString(),
});

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
      const columns = "id,source,status,model_url,front_rotation_y,updated_at";

      // La selección explícita del usuario es la fuente principal. Antes se leía
      // profiles.avatar_3d_url primero y eso hacía reaparecer el rig viejo con pelo.
      const { data: active, error: activeError } = await supabase
        .from("user_avatars")
        .select(columns)
        .eq("user_id", userId)
        .eq("is_active", true)
        .eq("status", "ready")
        .is("archived_at", null)
        .not("model_url", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeError) throw activeError;
      if (active?.model_url) {
        set({ avatar: mapAvatar(active), hydratedUserId: userId, loading: false });
        return;
      }

      // El perfil queda como respaldo para avatares oficiales antiguos que todavía
      // no tienen una fila correspondiente en user_avatars.
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("avatar_3d_url, updated_at")
        .eq("id", userId)
        .maybeSingle();

      if (profileError) throw profileError;
      const profileUrl = typeof profile?.avatar_3d_url === "string" ? profile.avatar_3d_url : null;
      if (profileUrl) {
        set({
          avatar: mapProfileAvatar(userId, profileUrl, profile?.updated_at),
          hydratedUserId: userId,
          loading: false,
        });
        return;
      }

      const { data: firstCreated, error: firstError } = await supabase
        .from("user_avatars")
        .select(columns)
        .eq("user_id", userId)
        .eq("status", "ready")
        .is("archived_at", null)
        .not("model_url", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (firstError) throw firstError;
      set({
        avatar: firstCreated?.model_url ? mapAvatar(firstCreated) : OFFICIAL_CLOUVA_AVATAR,
        hydratedUserId: userId,
        loading: false,
      });
    } catch (error) {
      console.error("Could not load CLOUVA avatar", error);
      set({ avatar: OFFICIAL_CLOUVA_AVATAR, hydratedUserId: userId, loading: false });
    }
  },
}));
