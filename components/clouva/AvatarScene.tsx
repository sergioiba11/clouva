"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { AvatarModel } from "@/components/clouva/AvatarModel";
import { CloverAIButton } from "@/components/clouva/CloverAIButton";
import { CloverAIPanel } from "@/components/clouva/CloverAIPanel";
import { MinimalNavigation } from "@/components/clouva/MinimalNavigation";
import { SpotifyMiniPlayer } from "@/components/clouva/SpotifyMiniPlayer";

export function AvatarScene() {
  const [aiOpen, setAiOpen] = useState(false);
  const [navVisible, setNavVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const revealNav = () => {
    setNavVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setNavVisible(false), 4000);
  };

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  return (
    <main className="clouva-experience" onClick={revealNav} onPointerMove={() => navVisible && revealNav()}>
      <div className="clouva-vignette" aria-hidden="true" />
      <section className="clouva-stage" aria-label="Experiencia principal CLOUVA">
        <Suspense fallback={<div className="clouva-loader">Cargando avatar</div>}>
          <AvatarModel />
        </Suspense>
      </section>
      <CloverAIButton open={aiOpen} onClick={() => setAiOpen((value) => !value)} />
      <CloverAIPanel open={aiOpen} />
      <SpotifyMiniPlayer />
      <MinimalNavigation visible={navVisible} />
    </main>
  );
}
