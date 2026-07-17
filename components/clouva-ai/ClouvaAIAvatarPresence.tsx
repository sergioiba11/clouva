"use client";

import { AvatarModelViewer } from "@/components/avatar-engine/AvatarModelViewer";
import { OFFICIAL_CLOUVA_MODEL_URL } from "@/lib/avatar-engine/active-avatar-store";

export function ClouvaAIAvatarPresence() {
  return (
    <section className="mx-auto flex w-full max-w-5xl shrink-0 items-center gap-3 px-4 py-2 text-white sm:px-6">
      <div className="h-16 w-14 shrink-0 overflow-hidden rounded-2xl border border-violet-400/25 bg-violet-500/10 shadow-lg shadow-violet-950/30">
        <AvatarModelViewer
          modelUrl={OFFICIAL_CLOUVA_MODEL_URL}
          alt="CLOUVA, artista y guía de la plataforma"
          className="h-full w-full"
          playAnimations
          poseMode="idle"
        />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-violet-300">
          Identidad oficial
        </p>
        <p className="truncate text-sm font-semibold">CLOUVA — artista, creador y guía</p>
        <p className="line-clamp-2 text-xs leading-5 text-white/50">
          Te acompaña a crear, publicar y vender. Su apariencia se actualiza globalmente cuando el admin publica una nueva versión.
        </p>
      </div>
    </section>
  );
}
