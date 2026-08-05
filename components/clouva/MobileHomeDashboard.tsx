"use client";

import Link from "next/link";
import {
  ArrowRight,
  Bell,
  CircleUserRound,
  Home,
  Music2,
  Plus,
  ShoppingBag,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CloverIcon } from "@/components/clover-icon";
import { useAuth } from "@/components/auth-provider";
import { useCurrentPlayer } from "@/components/current-player-provider";
import { resolveAccountDisplayName } from "@/lib/identity-names";
import { VISUAL_ASSETS } from "@/lib/visual-assets";
import styles from "./mobile-home-dashboard.module.css";

type MusicTrack = {
  id: string;
  title: string;
  status: string | null;
};

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function formatTrackStatus(value?: string | null) {
  if (!value) return "Proyecto musical";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function MobileHomeDashboard() {
  const { user, profile, loading } = useAuth();
  const { currentPlayer, playerLoading, playerReady } = useCurrentPlayer();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [latestTrack, setLatestTrack] = useState<MusicTrack | null>(null);
  const [musicLoading, setMusicLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadLatestTrack() {
      if (!user) {
        setLatestTrack(null);
        setMusicLoading(false);
        return;
      }

      setMusicLoading(true);
      try {
        const { supabase } = await import("@/lib/supabase");
        const { data } = await supabase
          .from("flow_music_tracks")
          .select("id,title,status")
          .eq("owner_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!cancelled) setLatestTrack((data as MusicTrack | null) ?? null);
      } catch {
        if (!cancelled) setLatestTrack(null);
      } finally {
        if (!cancelled) setMusicLoading(false);
      }
    }

    void loadLatestTrack();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const accountName = resolveAccountDisplayName({ profile, user });
  const profileImage = currentPlayer?.profile_image_url
    || currentPlayer?.logo_url
    || profile?.avatar_url
    || user?.user_metadata?.avatar_url;
  const profileFallback = useMemo(() => initials(accountName) || "C", [accountName]);

  if ((user && !playerReady) || loading) {
    return (
      <main className={styles.loading} aria-busy={loading || playerLoading} aria-label="Cargando CLOUVA">
        <CloverIcon size={34} />
      </main>
    );
  }

  const musicTitle = musicLoading
    ? "Cargando…"
    : latestTrack?.title || (profile?.spotify_url ? "Spotify conectado" : "Conectá tu música");
  const musicDetail = latestTrack
    ? formatTrackStatus(latestTrack.status)
    : profile?.spotify_url
      ? "Disponible en tu identidad"
      : "Llevá tu sonido a CLOUVA";

  return (
    <main className={styles.page}>
      <div className={styles.ambient} aria-hidden="true" />

      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Inicio de CLOUVA">
          <span className={styles.brandMark}><CloverIcon size={28} /></span>
          <strong>CLOUVA</strong>
        </Link>
        <button
          type="button"
          className={styles.notificationButton}
          onClick={() => setNotificationsOpen(true)}
          aria-label="Abrir notificaciones"
          aria-expanded={notificationsOpen}
        >
          <Bell size={23} />
        </button>
      </header>

      <section
        className={styles.hero}
        aria-labelledby="mobile-home-title"
        style={{ backgroundImage: `url(${VISUAL_ASSETS["home-avatar-atmosphere-01"]})` }}
      >
        <div className={styles.heroShade} aria-hidden="true" />
        <div className={styles.heroBrandVisual} aria-hidden="true">
          {profileImage ? <img src={String(profileImage)} alt="" /> : <CloverIcon size={160} />}
        </div>
        <div className={styles.heroContent}>
          <span>Bienvenido de nuevo</span>
          <h1 id="mobile-home-title">Crea.<br />Personaliza.<br />Conecta.</h1>
          <p>Viví tu propio mundo.</p>
          <div className={styles.heroActions}>
            <Link href="/mi-flow/avatar" className={styles.primaryAction}>
              <CircleUserRound size={18} />
              Entrar a mi Avatar
            </Link>
            <Link href="/matrix" className={styles.secondaryAction}>
              <Sparkles size={18} />
              Explorar Mundos
            </Link>
          </div>
        </div>
      </section>

      <section className={styles.musicCard} aria-label="Tu música en CLOUVA">
        <div
          className={styles.musicCover}
          style={{ backgroundImage: `url(${VISUAL_ASSETS["player-public-profile-cover-01"]})` }}
          aria-hidden="true"
        >
          <Music2 size={29} />
        </div>
        <div className={styles.musicInfo}>
          <small>Tu música</small>
          <h2>{musicTitle}</h2>
          <p>{musicDetail}</p>
          <Link href="/mi-flow/music">
            <Music2 size={16} />
            Abrir Música
            <ArrowRight size={15} />
          </Link>
        </div>
      </section>

      <section className={styles.featureGrid} aria-label="Acciones principales">
        <Link
          href="/creator-studio"
          className={styles.featureCard}
          style={{ backgroundImage: `url(${VISUAL_ASSETS["landing-card-store-01"]})` }}
        >
          <span className={styles.featureShade} aria-hidden="true" />
          <div>
            <h2>Continuar<br />creando</h2>
            <p>Seguí diseñando<br />tu próximo ítem.</p>
            <b aria-hidden="true"><ArrowRight size={20} /></b>
          </div>
        </Link>

        <Link
          href="/studios/iglu"
          className={styles.featureCard}
          style={{ backgroundImage: `url(${VISUAL_ASSETS["studio-directory-hero-01"]})` }}
        >
          <span className={styles.featureShade} aria-hidden="true" />
          <div>
            <h2>Entrar<br />al Iglú</h2>
            <p>Tu estudio.<br />Tu música.<br />Tu universo.</p>
            <b aria-hidden="true"><ArrowRight size={20} /></b>
          </div>
        </Link>
      </section>

      <nav className={styles.bottomNav} aria-label="Navegación principal móvil">
        <Link href="/" className={styles.activeNav}>
          <Home size={22} />
          <span>Inicio</span>
        </Link>
        <Link href="/mi-flow/avatar">
          <CircleUserRound size={22} />
          <span>Avatar</span>
        </Link>
        <Link href="/creator-studio" className={styles.createNav} aria-label="Crear en Creator Studio">
          <b><Plus size={31} /></b>
          <small>Crear</small>
        </Link>
        <Link href="/tienda">
          <ShoppingBag size={22} />
          <span>Marketplace</span>
        </Link>
        <Link href="/perfil" className={styles.profileNav} aria-label="Abrir mi perfil">
          {profileImage ? <img src={String(profileImage)} alt="" /> : <b>{profileFallback}</b>}
        </Link>
      </nav>

      {notificationsOpen ? (
        <div
          className={styles.drawerLayer}
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setNotificationsOpen(false);
          }}
        >
          <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="notifications-title">
            <header>
              <div>
                <small>CLOUVA</small>
                <h2 id="notifications-title">Notificaciones</h2>
              </div>
              <button type="button" onClick={() => setNotificationsOpen(false)} aria-label="Cerrar notificaciones">
                <X size={21} />
              </button>
            </header>
            <div className={styles.emptyNotifications}>
              <Bell size={27} />
              <strong>Todo al día</strong>
              <p>No tenés notificaciones nuevas.</p>
            </div>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
