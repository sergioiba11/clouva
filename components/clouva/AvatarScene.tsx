"use client";

import { Suspense, useState } from "react";
import { AvatarModel } from "@/components/clouva/AvatarModel";
import { CloverAIButton } from "@/components/clouva/CloverAIButton";
import { CloverAIPanel } from "@/components/clouva/CloverAIPanel";
import { MinimalNavigation } from "@/components/clouva/MinimalNavigation";
import { SpotifyMiniPlayer } from "@/components/clouva/SpotifyMiniPlayer";

export function AvatarScene() {
  const [interfaceVisible, setInterfaceVisible] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const activateInterface = () => {
    setInterfaceVisible(true);
    setAiOpen(true);
  };

  return (
    <main className="clouva-experience" aria-label="Universo CLOUVA">
      <div className="clouva-atmosphere" aria-hidden="true" />
      <div className="clouva-fog clouva-fog-one" aria-hidden="true" />
      <div className="clouva-fog clouva-fog-two" aria-hidden="true" />
      <div className="clouva-particles" aria-hidden="true" />
      <div className="clouva-floor" aria-hidden="true" />
      <div className="clouva-vignette" aria-hidden="true" />

      <section className="clouva-stage" aria-label="Personaje 3D CLOUVA">
        <Suspense fallback={<div className="clouva-loader" aria-hidden="true" />}>
          <AvatarModel />
        </Suspense>
      </section>

      <CloverAIButton open={aiOpen} onClick={interfaceVisible ? () => setAiOpen((value) => !value) : activateInterface} />

      {interfaceVisible ? (
        <>
          <CloverAIPanel open={aiOpen} />
          <SpotifyMiniPlayer />
          <MinimalNavigation visible />
        </>
      ) : null}
    </main>
  );
}
