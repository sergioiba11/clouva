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
  fallbackUrl: TEMPORARY_RIG_URL,
  status: "ready",
  frontRotationY: 0,
  updatedAt: "2026-07-13T00:00:00.000Z",
};

type ActiveAvatarStore = {
  avatar: ActiveAvatar;
  setActiveAvatar: (avatar: ActiveAvatar) => void;
  useOfficialAvatar: () => void;
  setStatus: (status: ActiveAvatarStatus) => void;
};

export const useActiveAvatarStore = create<ActiveAvatarStore>((set) => ({
  avatar: OFFICIAL_CLOUVA_AVATAR,
  setActiveAvatar: (avatar) => set({ avatar }),
  useOfficialAvatar: () => set({ avatar: OFFICIAL_CLOUVA_AVATAR }),
  setStatus: (status) => set((state) => ({ avatar: { ...state.avatar, status } })),
}));
