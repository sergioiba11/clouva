"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useAuth } from "@/components/auth-provider";
import { CreatorStudioSimple } from "@/components/creator-studio/CreatorStudioSimple";
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
      <div className="flex min-h-[70vh] items-center justify-center bg-[#050507] text-sm text-white/60">
        Preparando el Creator Studio…
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#050507]">
      <div className="mx-auto flex max-w-[1100px] justify-end px-4 pt-4">
        <Link
          href="/creator-studio/objects"
          className="rounded-full border border-violet-400/20 bg-violet-500/10 px-4 py-2 text-xs font-bold text-violet-200 transition hover:border-violet-400/40 hover:bg-violet-500/15"
        >
          Objetos & accesorios 3D →
        </Link>
      </div>
      <CreatorStudioSimple />
    </main>
  );
}
