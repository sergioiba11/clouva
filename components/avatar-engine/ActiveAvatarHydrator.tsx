"use client";

import { useEffect } from "react";
import { useAuth } from "@/components/auth-provider";
import { useActiveAvatarStore } from "@/lib/avatar-engine/active-avatar-store";

export function ActiveAvatarHydrator() {
  const { user, hydrationReady } = useAuth();
  const loadActiveAvatar = useActiveAvatarStore((state) => state.loadActiveAvatar);

  useEffect(() => {
    if (!hydrationReady) return;
    void loadActiveAvatar(user?.id ?? null);
  }, [hydrationReady, user?.id, loadActiveAvatar]);

  return null;
}
