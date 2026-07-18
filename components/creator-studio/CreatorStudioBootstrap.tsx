"use client";

import { useEffect } from "react";
import { useAuth } from "@/components/auth-provider";
import { CreatorStudioPro } from "@/components/creator-studio/CreatorStudioPro";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";

export function CreatorStudioBootstrap() {
  const { user, profileReady } = useAuth();
  const loadActiveAvatar = useActiveAvatarStore((state) => state.loadActiveAvatar);
  const loadingAvatar = useActiveAvatarStore((state) => state.loading);

  useEffect(() => {
    if (!profileReady) return;
    void loadActiveAvatar(user?.id ?? null);
  }, [loadActiveAvatar, profileReady, user?.id]);

  if (!profileReady || loadingAvatar) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center bg-[#060408] text-sm text-white/60">
        Cargando avatar riggeado…
      </div>
    );
  }

  return <CreatorStudioPro />;
}
