"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bell,
  CircleUserRound,
  Heart,
  Home,
  Pause,
  Plus,
  ShoppingBag,
  SkipBack,
  SkipForward,
  Sparkles,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { CloverIcon } from "@/components/clover-icon";
import { useAuth } from "@/components/auth-provider";
import { useCurrentPlayer } from "@/components/current-player-provider";
import { resolveAccountDisplayName } from "@/lib/identity-names";
import styles from "./mobile-home-dashboard.module.css";

const HOME_ASSETS = {
  hero: "/assets/home-mobile/hero.webp",
  music: "/assets/home-mobile/music-cover.webp",
  continue: "/assets/home-mobile/continue.webp",
  iglu: "/assets/home-mobile/iglu.webp",
  brandAvatar: "/assets/home-mobile/brand-avatar.webp",
} as const;

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function MobileHomeDashboard() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const { currentPlayer, playerLoading, playerReady } = useCurrentPlayer();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [favorite, setFavorite] = useState(true);

  const accountName = resolveAccountDisplayName({ profile, user });
  const playerImage = currentPlayer?.profile_image_url
    || currentPlayer?.logo_url
    || profile?.avatar_url
    || null;
  const profileFallback = useMemo(() => initials(accountName) || "C", [accountName]);

  if ((user && !playerReady) || loading) {
    return (
      <main className={styles.loading} aria-busy={loading || playerLoading} aria-label="Cargando CLOUVA">
        <CloverIcon size={34} />
      </main>
    );
  }

  const openMusic = () => router.push("/mi-flow/music");

  return (
    <main className={styles.page}>
      <div className={styles.ambient} aria-hidden="true" />

      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Inicio de CLOUVA">
          <span className={styles.brandMark}><CloverIcon size={29} /></span>
          <strong>CLOUVA</strong>
        </Link>

        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.notificationButton}
            onClick={() => setNotificationsOpen(true)}
            aria-label="Abrir notificaciones"
            aria-expanded={notificationsOpen}
          >
            <Bell size={24} />
            <span aria-hidden="true" />
          </button>
          <span className={styles.brandAvatar} aria-hidden="true">
            <img src={HOME_ASSETS.brandAvatar} alt="" />
          </span>
        </div>
      </header>

      <section
        className={styles.hero}
        aria-labelledby="mobile-home-title"
        style={{ backgroundImage: `url(${HOME_ASSETS.hero})` }}
      >
        <div className={styles.heroShade} aria-hidden="true" />
        <div className={styles.heroContent}>
          <span>Bienvenido de nuevo</span>
          <h1 id="mobile-home-title">Crea. Personaliza.<br />Conecta.</h1>
          <p>Viví tu propio mundo.</p>
          <div className={styles.heroActions}>
            <Link href="/mi-flow/avatar" className={styles.primaryAction}>
              <CircleUserRound size={17} />
              Entrar a mi Avatar
            </Link>
            <Link href="/matrix" className={styles.secondaryAction}>
              <Sparkles size={17} />
              Explorar Mundos
            </Link>
          </div>
        </div>
      </section>

      <section className={styles.musicCard} aria-label="Vida de Flows, Clouva">
        <button type="button" className={styles.musicCover} onClick={openMusic} aria-label="Abrir Vida de Flows">
          <img src={HOME_ASSETS.music} alt="Portada de Vida de Flows" />
        </button>

        <div className={styles.musicPanel}>
          <div className={styles.musicHeading}>
            <div>
              <h2>Vida de Flows</h2>
              <p>Clouva</p>
            </div>
            <button
              type="button"
              className={favorite ? styles.favoriteActive : styles.favoriteButton}
              onClick={() => setFavorite((value) => !value)}
              aria-label={favorite ? "Quitar de favoritos" : "Agregar a favoritos"}
            >
              <Heart size={23} fill={favorite ? "currentColor" : "none"} />
            </button>
          </div>

          <button type="button" className={styles.progressButton} onClick={openMusic} aria-label="Abrir reproductor musical">
            <span><i /></span>
          </button>
          <div className={styles.musicTimes}><span>1:32</span><span>3:24</span></div>

          <div className={styles.musicControls}>
            <button type="button" onClick={openMusic} aria-label="Tema anterior"><SkipBack size={22} fill="currentColor" /></button>
            <button type="button" className={styles.playButton} onClick={openMusic} aria-label="Abrir reproductor"><Pause size={25} fill="currentColor" /></button>
            <button type="button" onClick={openMusic} aria-label="Tema siguiente"><SkipForward size={22} fill="currentColor" /></button>
          </div>
        </div>
      </section>

      <section className={styles.featureGrid} aria-label="Acciones principales">
        <Link
          href="/creator-studio"
          className={styles.featureCard}
          style={{ backgroundImage: `url(${HOME_ASSETS.continue})` }}
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
          style={{ backgroundImage: `url(${HOME_ASSETS.iglu})` }}
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
          <Home size={22} fill="currentColor" />
          <span>Inicio</span>
        </Link>
        <Link href="/mi-flow/avatar">
          <CircleUserRound size={23} />
          <span>Avatar</span>
        </Link>
        <Link href="/creator-studio" className={styles.createNav} aria-label="Crear en Creator Studio">
          <b><Plus size={32} /></b>
          <small>Crear</small>
        </Link>
        <Link href="/tienda">
          <ShoppingBag size={23} />
          <span>Marketplace</span>
        </Link>
        <Link href="/perfil" className={styles.profileNav} aria-label="Abrir mi Player">
          {playerImage ? <img src={String(playerImage)} alt="" /> : <b>{profileFallback}</b>}
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
