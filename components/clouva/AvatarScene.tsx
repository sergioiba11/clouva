"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { AvatarModel } from "@/components/clouva/AvatarModel";
import { CloverAIButton } from "@/components/clouva/CloverAIButton";
import { CloverAIPanel } from "@/components/clouva/CloverAIPanel";
import { MinimalNavigation } from "@/components/clouva/MinimalNavigation";
import { SpotifyMiniPlayer } from "@/components/clouva/SpotifyMiniPlayer";

export function AvatarScene() {
  const [interfaceVisible, setInterfaceVisible] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showInterfaceTemporarily = () => {
    setInterfaceVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setInterfaceVisible(false), 4000);
  };

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  return (
    <main className="clouva-experience" aria-label="Universo CLOUVA" onPointerDown={showInterfaceTemporarily}>
      <div className="clouva-atmosphere" aria-hidden="true" />
      <div className="clouva-fog clouva-fog-one" aria-hidden="true" />
      <div className="clouva-floor" aria-hidden="true" />
      <div className="clouva-vignette" aria-hidden="true" />

      <section className="clouva-stage" aria-label="Personaje 3D CLOUVA" onPointerDown={(event) => event.stopPropagation()}>
        <Suspense fallback={<div className="clouva-loader" aria-hidden="true" />}>
          <AvatarModel />
        </Suspense>
      </section>

      <CloverAIButton open={aiOpen} onClick={() => setAiOpen((value) => !value)} />
      <CloverAIPanel open={aiOpen} onClose={() => setAiOpen(false)} />
      <SpotifyMiniPlayer visible={interfaceVisible} />
      <MinimalNavigation visible={interfaceVisible} />
    </main>
  );
}
