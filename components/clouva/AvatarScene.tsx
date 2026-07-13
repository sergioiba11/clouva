"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Pause, Play, Radio } from "lucide-react";
import { AvatarModel } from "@/components/clouva/AvatarModel";
import { CloverAIButton } from "@/components/clouva/CloverAIButton";
import { CloverAIPanel } from "@/components/clouva/CloverAIPanel";
import { MinimalNavigation } from "@/components/clouva/MinimalNavigation";


export function AvatarScene() {
  const [interfaceVisible, setInterfaceVisible] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
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
    <main className="clouva-experience" aria-label="Universo CLOUVA" onPointerDown={(event) => { if (event.target === event.currentTarget) showInterfaceTemporarily(); }}>
      <div className="clouva-atmosphere" aria-hidden="true" />
      <div className="clouva-fog clouva-fog-one" aria-hidden="true" />
      <div className="clouva-fog clouva-fog-two" aria-hidden="true" />
      <div className="clouva-particles" aria-hidden="true" />
      <div className="clouva-floor" aria-hidden="true" />
      <div className="clouva-vignette" aria-hidden="true" />

      <section className="clouva-stage" aria-label="Personaje 3D CLOUVA" onPointerDown={(event) => event.stopPropagation()}>
        <Suspense fallback={<div className="clouva-loader" aria-hidden="true" />}>
          <AvatarModel />
        </Suspense>
      </section>

      <section className={`clouva-hero-card clouva-ui ${interfaceVisible ? "clouva-ui-visible" : ""}`} aria-hidden={!interfaceVisible}>
        <p className="clouva-kicker">CLOUVA ID</p>
        <h1>IAN</h1>
        <p className="clouva-handle">@ian.clouva</p>
        <div className="clouva-xp"><span style={{ width: "64%" }} /></div>
        <div className="clouva-stats"><b>Nivel 42</b><b>12.850 XP</b><b>Argentina</b></div>
        <p className="clouva-role">Rol: artista / creador</p>
      </section>

      <section className={`clouva-music-card clouva-ui ${interfaceVisible ? "clouva-ui-visible" : ""}`} aria-label="Música integrada">
        <div className="clouva-card-head"><Radio className="h-4 w-4" /> Música</div>
        <div className="clouva-cover"><span>DESDE CRÍO</span></div>
        <p className="clouva-track">Ian — canción principal</p>
        <button type="button" className="clouva-play" onClick={(event) => { event.stopPropagation(); setPlaying((value) => !value); }}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>

      </section>

      <CloverAIButton open={aiOpen} onClick={() => setAiOpen((value) => !value)} />
      <CloverAIPanel open={aiOpen} onClose={() => setAiOpen(false)} />
      <MinimalNavigation visible={interfaceVisible} />
    </main>
  );
}
