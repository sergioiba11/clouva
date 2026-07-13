"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { BarChart3, Bookmark, Heart, MessageCircle, Pause, Play, Radio, ShoppingBag, Sparkles, Users } from "lucide-react";
import { AvatarModel } from "@/components/clouva/AvatarModel";
import { CloverAIButton } from "@/components/clouva/CloverAIButton";
import { CloverAIPanel } from "@/components/clouva/CloverAIPanel";
import { MinimalNavigation } from "@/components/clouva/MinimalNavigation";

const merch = [
  ["Clover Hoodie", "$45.000", "hoodie"],
  ["Cargo Black", "$60.000", "pants"],
  ["Chain 404", "$15.000", "chain"],
  ["Dark Cap", "$22.000", "cap"],
];

const community = [
  ["@ian.clouva", "Nuevo lanzamiento: DESDE CRÍO", "542"],
  ["@ana.design", "Drop baggy nocturno disponible", "318"],
];

export function AvatarScene() {
  const [interfaceVisible, setInterfaceVisible] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showInterfaceTemporarily = () => {
    setInterfaceVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setInterfaceVisible(false), 7000);
  };

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  return (
    <main className="clouva-experience" aria-label="Universo CLOUVA" onPointerDown={showInterfaceTemporarily}>
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
        <p className="clouva-kicker">CLOUVA / IDENTIDAD</p>
        <h1>IAN</h1>
        <p className="clouva-handle">@ian.clouva · creador verificado</p>
        <div className="clouva-xp"><span style={{ width: "64%" }} /></div>
        <div className="clouva-stats"><b>Nivel 42</b><b>12.850 XP</b><b>Argentina</b></div>
        <p className="clouva-role">Artista · diseñador · vendedor de drops</p>
      </section>

      <section className={`clouva-music-card clouva-ui ${interfaceVisible ? "clouva-ui-visible" : ""}`} aria-label="Música integrada">
        <div className="clouva-card-head"><Radio className="h-4 w-4" /> Música</div>
        <div className="clouva-tabs"><span>Spotify</span><span>YouTube</span></div>
        <div className="clouva-cover"><span>DESDE CRÍO</span></div>
        <p className="clouva-track">Ian — canción principal</p>
        <div className="clouva-progress"><span style={{ width: "32%" }} /></div>
        <button type="button" className="clouva-play" onClick={(event) => { event.stopPropagation(); setPlaying((value) => !value); }}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <div className="clouva-streams"><span>ZIGZAG 1.3M</span><span>MODO SSJ 1.5M</span></div>
      </section>

      <section className={`clouva-locker-card clouva-ui ${interfaceVisible ? "clouva-ui-visible" : ""}`} aria-label="Locker de avatar">
        <div className="clouva-card-head"><Sparkles className="h-4 w-4" /> Avatar locker</div>
        <div className="clouva-locker-tabs"><span>Outfit</span><span>Accesorios</span><span>Apariencia</span><span>Animaciones</span></div>
        <div className="clouva-thumb-row">{merch.map(([name,, kind]) => <button key={name} type="button" className={`clouva-thumb ${kind}`}>{name}</button>)}</div>
      </section>

      <section className={`clouva-market-card clouva-ui ${interfaceVisible ? "clouva-ui-visible" : ""}`} aria-label="Merch y marketplace">
        <div className="clouva-card-head"><ShoppingBag className="h-4 w-4" /> Tienda + colección</div>
        <div className="clouva-product-grid">{merch.map(([name, price, kind]) => <article key={name} className="clouva-product"><div className={`clouva-product-art ${kind}`} /><b>{name}</b><span>{price}</span><button>Probar</button><Bookmark className="h-3.5 w-3.5" /></article>)}</div>
      </section>

      <section className={`clouva-social-card clouva-ui ${interfaceVisible ? "clouva-ui-visible" : ""}`} aria-label="Comunidad CLOUVA">
        <div className="clouva-card-head"><Users className="h-4 w-4" /> Comunidad</div>
        {community.map(([user, text, likes]) => <article key={user} className="clouva-post"><b>{user}</b><p>{text}</p><span><Heart className="h-3 w-3" /> {likes} <MessageCircle className="h-3 w-3" /> 32</span></article>)}
      </section>

      <section className={`clouva-maker-card clouva-ui ${interfaceVisible ? "clouva-ui-visible" : ""}`} aria-label="Creador de merch">
        <div className="clouva-card-head"><BarChart3 className="h-4 w-4" /> Diseña tu merch</div>
        <div className="clouva-steps"><span>1 Prenda</span><span>2 Diseño</span><span>3 Vista IA</span><span>4 Publicar</span></div>
      </section>

      <CloverAIButton open={aiOpen} onClick={() => setAiOpen((value) => !value)} />
      <CloverAIPanel open={aiOpen} onClose={() => setAiOpen(false)} />
      <MinimalNavigation visible={interfaceVisible} />
    </main>
  );
}
