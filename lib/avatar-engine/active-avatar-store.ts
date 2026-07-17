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

/**
 * CLOUVA is the platform creator/guide avatar. This endpoint always resolves
 * the currently published admin avatar, so an admin update reaches everybody
 * without copying it into every user profile.
 */
export const OFFICIAL_CLOUVA_MODEL_URL = "/api/avatar/official/model";

export const OFFICIAL_CLOUVA_AVATAR: ActiveAvatar = {
  id: "clouva-ai-official",
  source: "official",
  modelUrl: OFFICIAL_CLOUVA_MODEL_URL,
  fallbackUrl: null,
  status: "ready",
  frontRotationY: 0,
  updatedAt: "2026-07-17T00:00:00.000Z",
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
  fallbackUrl: OFFICIAL_CLOUVA_MODEL_URL,
  status: "ready",
  frontRotationY: Number(data.front_rotation_y ?? 0),
  updatedAt: data.updated_at ?? new Date().toISOString(),
});

const mapLegacyProfileAvatar = (
  userId: string,
  modelUrl: string,
  updatedAt?: string | null,
): ActiveAvatar => ({
  id: `profile-avatar-${userId}`,
  source: "generated",
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

      // A real user avatar always wins over CLOUVA and over legacy profile URLs.
      const { data: active, error: activeError } = await supabase
        .from("user_avatars")
        .select(columns)
        .eq("user_id", userId)
        .eq("is_active", true)
        .eq("status", "ready")
        .not("model_url", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeError) throw activeError;
      if (active?.model_url) {
        set({ avatar: mapAvatar(active), hydratedUserId: userId, loading: false });
        return;
      }

      const { data: readyAvatar, error: readyError } = await supabase
        .from("user_avatars")
        .select(columns)
        .eq("user_id", userId)
        .eq("status", "ready")
        .not("model_url", "is", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (readyError) throw readyError;
      if (readyAvatar?.model_url) {
        set({ avatar: mapAvatar(readyAvatar), hydratedUserId: userId, loading: false });
        return;
      }

      // Compatibility for avatars that were validated from Admin before
      // user_avatars became the canonical table.
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("avatar_3d_url, updated_at")
        .eq("id", userId)
        .maybeSingle();

      if (profileError) throw profileError;
      const profileAvatarUrl =
        typeof profile?.avatar_3d_url === "string" && profile.avatar_3d_url.trim()
          ? profile.avatar_3d_url
          : null;

      if (profileAvatarUrl) {
        set({
          avatar: mapLegacyProfileAvatar(userId, profileAvatarUrl, profile?.updated_at),
          hydratedUserId: userId,
          loading: false,
        });
        return;
      }

      // Before creating a personal avatar, the profile displays CLOUVA as the
      // starter guide. This is a shared reference, not ownership by the user.
      set({ avatar: OFFICIAL_CLOUVA_AVATAR, hydratedUserId: userId, loading: false });
    } catch (error) {
      console.error("Could not load CLOUVA avatar", error);
      set({ avatar: OFFICIAL_CLOUVA_AVATAR, hydratedUserId: userId, loading: false });
    }
  },
}));
