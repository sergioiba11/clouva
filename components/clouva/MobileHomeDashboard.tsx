"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties, MouseEvent } from "react";
import {
  ArrowRight,
  Bell,
  CircleUserRound,
  Heart,
  Home,
  Pause,
  Play,
  Plus,
  ShoppingBag,
  SkipBack,
  SkipForward,
  Sparkles,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { useCurrentPlayer } from "@/components/current-player-provider";
import { AccountMenu } from "@/components/account/AccountMenu";
import { SpotifyHomeConnectAction } from "@/components/music/SpotifyHomeConnectAction";
import { useSpotifyPlayback } from "@/components/music/SpotifyPlaybackProvider";
import { OfficialClouvaMark } from "@/components/clouva/OfficialClouvaMark";
import { resolveAccountDisplayName } from "@/lib/identity-names";
import {
  getNavigationItems,
  getPlayerDestination,
  MOBILE_PRIMARY_NAV_KEYS,
} from "@/lib/navigation/clouva-navigation";
import {
  configCssVariables,
  DEFAULT_MOBILE_HOME_CONFIG,
  sanitizeMobileHomeConfig,
  type MobileHomeCardConfig,
  type MobileHomeConfig,
  type MobileHomeSectionKey,
} from "@/lib/clouva-lab/mobile-home-config";
import { usePublishedUiPage } from "@/lib/clouva-lab/use-published-ui-page";
import styles from "./mobile-home-dashboard.module.css";
import labStyles from "./mobile-home-lab.module.css";

const [homeNav, playerNav, createNav, marketNav, miFlowNav] = getNavigationItems(MOBILE_PRIMARY_NAV_KEYS);

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function multiline(value: string) {
  return value.split("\n").map((line, index, lines) => (
    <span key={`${line}-${index}`}>
      {line}
      {index < lines.length - 1 ? <br /> : null}
    </span>
  ));
}

function formatTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

type MobileHomeDashboardProps = {
  configOverride?: MobileHomeConfig;
  previewMode?: boolean;
};

export function MobileHomeDashboard({ configOverride, previewMode = false }: MobileHomeDashboardProps = {}) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { currentPlayer } = useCurrentPlayer();
  const { playback, scopesReady, busyAction, controlPlayback } = useSpotifyPlayback();
  const { config, version } = usePublishedUiPage(
    "mobile-home",
    DEFAULT_MOBILE_HOME_CONFIG,
    sanitizeMobileHomeConfig,
    configOverride,
  );
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [favorite, setFavorite] = useState(config.music.favoriteDefault);
  const [showSpotifyConnect, setShowSpotifyConnect] = useState(false);

  useEffect(() => {
    setFavorite(config.music.favoriteDefault);
  }, [config.music.favoriteDefault]);

  const accountName = resolveAccountDisplayName({ profile, user });
  const playerImage = currentPlayer?.profile_image_url
    || currentPlayer?.logo_url
    || profile?.avatar_url
    || null;
  const playerDisplayName = currentPlayer?.display_name?.trim()
    || currentPlayer?.username?.trim()
    || accountName;
  const profileFallback = useMemo(() => initials(playerDisplayName) || "C", [playerDisplayName]);
  const publicProfileHref = getPlayerDestination(currentPlayer);
  const cssVariables = useMemo(
    () => ({ ...configCssVariables(config), backgroundColor: config.theme.backgroundColor }) as CSSProperties,
    [config],
  );

  const preventPreviewNavigation = (event: MouseEvent<HTMLElement>) => {
    if (previewMode) event.preventDefault();
  };
  const openMusic = () => {
    if (!previewMode) router.push("/mi-flow/music");
  };
  const runPlayback = (action: "play" | "pause" | "next" | "previous") => {
    if (previewMode || !playback || !scopesReady) {
      openMusic();
      return;
    }
    void controlPlayback(action).catch(() => undefined);
  };

  function renderHero() {
    return (
      <section
        key="hero"
        className={styles.hero}
        aria-labelledby="mobile-home-title"
        style={{
          background: "transparent",
          borderColor: "transparent",
          boxShadow: "none",
        }}
        data-clouva-block="hero"
      >
        <div
          className={styles.heroContent}
          style={{
            width: "100%",
            alignItems: "center",
            textAlign: "center",
            padding: "24px 16px",
          }}
        >
          <span>{config.hero.eyebrow}</span>
          <h1 id="mobile-home-title">{multiline(config.hero.title)}</h1>
          <p>{config.hero.subtitle}</p>
          <div className={styles.heroActions}>
            <Link href={config.hero.primaryHref} className={styles.primaryAction} onClick={preventPreviewNavigation}>
              <CircleUserRound size={17} />
              {config.hero.primaryLabel}
            </Link>
            <Link href={config.hero.secondaryHref} className={styles.secondaryAction} onClick={preventPreviewNavigation}>
              <Sparkles size={17} />
              {config.hero.secondaryLabel}
            </Link>
          </div>
        </div>
      </section>
    );
  }

  function renderMusic() {
    if (!config.music.visible) return null;
    const title = playback?.track.title || config.music.title;
    const artist = playback?.track.artist || config.music.artist;
    const coverUrl = playback?.track.coverUrl || config.music.coverUrl;
    const currentTime = playback ? formatTime(playback.progressMs) : config.music.currentTime;
    const duration = playback ? formatTime(playback.durationMs) : config.music.duration;
    const progress = playback?.durationMs
      ? Math.min(100, Math.max(0, (playback.progressMs / playback.durationMs) * 100))
      : null;

    return (
      <section key="music" className={styles.musicCard} aria-label={`${title}, ${artist}`} data-clouva-block="music">
        <button type="button" className={styles.musicCover} onClick={openMusic} aria-label={`Abrir ${title}`}>
          <img src={coverUrl} alt={`Portada de ${title}`} />
        </button>

        <div className={styles.musicPanel}>
          <div className={styles.musicHeading}>
            <div>
              <h2>{title}</h2>
              <p>{artist}</p>
            </div>
            <button
              type="button"
              className={favorite ? styles.favoriteActive : styles.favoriteButton}
              onClick={() => {
                setFavorite((value) => !value);
                if (!previewMode) setShowSpotifyConnect(true);
              }}
              aria-label={favorite ? "Quitar de favoritos" : "Agregar a favoritos"}
            >
              <Heart size={23} fill={favorite ? "currentColor" : "none"} />
            </button>
          </div>

          {showSpotifyConnect && !previewMode ? (
            <div style={{ marginTop: 2 }}>
              <SpotifyHomeConnectAction />
            </div>
          ) : null}

          <button type="button" className={styles.progressButton} onClick={openMusic} aria-label="Abrir reproductor musical">
            <span><i style={progress === null ? undefined : { width: `${progress}%` }} /></span>
          </button>
          <div className={styles.musicTimes}><span>{currentTime}</span><span>{duration}</span></div>

          <div className={styles.musicControls}>
            <button type="button" onClick={() => runPlayback("previous")} disabled={Boolean(busyAction)} aria-label="Tema anterior"><SkipBack size={22} fill="currentColor" /></button>
            <button type="button" className={styles.playButton} onClick={() => runPlayback(playback?.isPlaying ? "pause" : "play")} disabled={Boolean(busyAction)} aria-label={playback?.isPlaying ? "Pausar" : "Reproducir"}>
              {playback?.isPlaying ? <Pause size={25} fill="currentColor" /> : <Play size={25} fill="currentColor" />}
            </button>
            <button type="button" onClick={() => runPlayback("next")} disabled={Boolean(busyAction)} aria-label="Tema siguiente"><SkipForward size={22} fill="currentColor" /></button>
          </div>
        </div>
      </section>
    );
  }

  function featureCard(id: "continue" | "iglu", card: MobileHomeCardConfig) {
    if (!card.visible) return null;
    const isVipCard = id === "continue";
    const isSpotCard = id === "iglu";
    const title = isVipCard ? "Desbloquea funciones VIP" : isSpotCard ? "Entrar a mi spot" : card.title;
    const body = isVipCard ? "" : card.body;

    return (
      <Link
        key={id}
        href={card.href}
        className={styles.featureCard}
        style={isVipCard
          ? { background: "transparent", boxShadow: "none" }
          : { backgroundImage: `url(${card.imageUrl})` }}
        onClick={preventPreviewNavigation}
        data-clouva-block={id}
      >
        {!isVipCard ? <span className={styles.featureShade} aria-hidden="true" /> : null}
        <div
          style={isVipCard
            ? {
                width: "100%",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                padding: 16,
              }
            : undefined}
        >
          <h2>{multiline(title)}</h2>
          {body ? <p>{multiline(body)}</p> : null}
          <b aria-hidden="true"><ArrowRight size={20} /></b>
        </div>
      </Link>
    );
  }

  function renderFeatures() {
    const cards = [featureCard("continue", config.cards.continue), featureCard("iglu", config.cards.iglu)].filter(Boolean);
    if (cards.length === 0) return null;
    return (
      <section key="features" className={styles.featureGrid} aria-label="Acciones principales" data-clouva-block="features">
        {cards}
      </section>
    );
  }

  const sectionRenderers: Record<MobileHomeSectionKey, () => React.ReactNode> = {
    hero: renderHero,
    music: renderMusic,
    features: renderFeatures,
  };

  return (
    <main
      className={`${styles.page} ${labStyles.configurablePage} ${previewMode ? labStyles.previewPage : ""}`}
      style={cssVariables}
      data-ui-page="mobile-home"
      data-ui-version={version ?? "draft-preview"}
      data-ui-preview={previewMode ? "true" : "false"}
    >
      <div className={styles.ambient} data-clouva-ambient aria-hidden="true" />

      <header className={styles.header} data-clouva-block="header">
        <Link href={homeNav.href} className={styles.brand} aria-label="Inicio de CLOUVA" onClick={preventPreviewNavigation}>
          <span className={`${styles.brandMark} overflow-hidden rounded-full`}>
            <OfficialClouvaMark tone="light" className="h-full w-full scale-[1.75] object-cover" />
          </span>
          <strong>{config.header.logoText}</strong>
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
            {config.header.showNotificationDot ? <span aria-hidden="true" /> : null}
          </button>
          {!previewMode ? (
            <AccountMenu
              variant="home"
              triggerImageUrl={playerImage ?? undefined}
            />
          ) : playerImage ? (
            <span className={styles.brandAvatar} aria-hidden="true">
              <img src={playerImage} alt="" />
            </span>
          ) : config.header.showBrandAvatar ? (
            <span className={styles.brandAvatar} aria-hidden="true">
              <img src={config.header.brandAvatarUrl} alt="" />
            </span>
          ) : null}
        </div>
      </header>

      {config.sections.map((section) => sectionRenderers[section]())}

      <nav className={styles.bottomNav} aria-label="Navegación principal móvil" data-clouva-block="navigation">
        <Link href={homeNav.href} className={styles.activeNav} onClick={preventPreviewNavigation}>
          <Home size={22} fill="currentColor" />
          <span>{homeNav.label}</span>
        </Link>
        <Link href={publicProfileHref} className={styles.profileNav} aria-label={`Abrir Player de ${playerDisplayName}`} onClick={preventPreviewNavigation}>
          {playerImage ? <img src={String(playerImage)} alt="" /> : <b>{profileFallback}</b>}
          <span>{playerDisplayName}</span>
        </Link>
        <Link href={createNav.href} className={styles.createNav} aria-label="Crear en CLOUVA" onClick={preventPreviewNavigation}>
          <b><Plus size={32} /></b>
          <small>{createNav.label}</small>
        </Link>
        <Link href={marketNav.href} onClick={preventPreviewNavigation}>
          <ShoppingBag size={23} />
          <span>{marketNav.label}</span>
        </Link>
        <Link href={miFlowNav.href} aria-label="Abrir Mi Flow" onClick={preventPreviewNavigation}>
          <WalletCards size={23} />
          <span>{miFlowNav.label}</span>
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
