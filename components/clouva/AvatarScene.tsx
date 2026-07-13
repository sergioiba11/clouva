"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { AvatarModel } from "@/components/clouva/AvatarModel";
import { CloverAIButton } from "@/components/clouva/CloverAIButton";
import { CloverAIPanel } from "@/components/clouva/CloverAIPanel";
import { MinimalNavigation } from "@/components/clouva/MinimalNavigation";
import { useAuth } from "@/components/auth-provider";
import { spotifyEmbedUrl } from "@/lib/spotify";

export function AvatarScene() {
  const { user, profile } = useAuth();
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

  const displayName = profile?.full_name || profile?.display_name || (user ? "Tu CLOUVA" : "Invitado");
  const handle = profile?.username ? `@${profile.username}` : user ? "Sin username todavía" : "Iniciá sesión";
  const embedUrl = spotifyEmbedUrl(profile?.spotify_url);

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
        <h1>{displayName}</h1>
        <p className="clouva-handle">{handle}</p>
        {profile?.role ? <p className="clouva-role">Rol: {profile.role}</p> : null}
      </section>

      {embedUrl ? (
        <section className={`clouva-music-card clouva-ui ${interfaceVisible ? "clouva-ui-visible" : ""}`} aria-label="Música integrada" onPointerDown={(event) => event.stopPropagation()}>
          <div className="clouva-card-head"><Radio className="h-4 w-4" /> Música</div>
          <iframe src={embedUrl} width="100%" height="80" style={{ border: "none", borderRadius: "12px" }} allow="encrypted-media" loading="lazy" />
        </section>
      ) : null}

      <CloverAIButton open={aiOpen} onClick={() => setAiOpen((value) => !value)} />
      <CloverAIPanel open={aiOpen} onClose={() => setAiOpen(false)} />
      <MinimalNavigation visible={interfaceVisible} />
    </main>
  );
}
