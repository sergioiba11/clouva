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
  Plus,
  ShoppingBag,
  SkipBack,
  SkipForward,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CloverIcon } from "@/components/clover-icon";
import { useAuth } from "@/components/auth-provider";
import { useCurrentPlayer } from "@/components/current-player-provider";
import { AccountMenu } from "@/components/account/AccountMenu";
import { SpotifyHomeConnectAction } from "@/components/music/SpotifyHomeConnectAction";
import { resolveAccountDisplayName, resolveCurrentPlayerStatus } from "@/lib/identity-names";
import {
  configCssVariables,
  DEFAULT_MOBILE_HOME_CONFIG,
  sanitizeMobileHomeConfig,
  type MobileHomeCardConfig,
  type MobileHomeConfig,
  type MobileHomeSectionKey,
} from "@/lib/clouva-lab/mobile-home-config";
import { usePublishedUiPage } from "@/lib/clouva-lab/use-published-ui-page";
import { VISUAL_ASSETS } from "@/lib/visual-assets";
import styles from "./mobile-home-dashboard.module.css";
import labStyles from "./mobile-home-lab.module.css";

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

type MobileHomeDashboardProps = {
  configOverride?: MobileHomeConfig;
  previewMode?: boolean;
};

export function MobileHomeDashboard({ configOverride, previewMode = false }: MobileHomeDashboardProps = {}) {
  const router = useRouter();
  const { user, profile, role, loading } = useAuth();
  const { currentPlayer, playerLoading, playerReady } = useCurrentPlayer();
  const { config, version, loading: configLoading } = usePublishedUiPage(
    "mobile-home",
    DEFAULT_MOBILE_HOME_CONFIG,
    sanitizeMobileHomeConfig,
    configOverride,
  );
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [favorite, setFavorite] = useState(config.music.favoriteDefault);

  useEffect(() => {
    setFavorite(config.music.favoriteDefault);
  }, [config.music.favoriteDefault]);

  const accountName = resolveAccountDisplayName({ profile, user });
  const playerImage = currentPlayer?.profile_image_url
    || currentPlayer?.logo_url
    || profile?.avatar_url
    || null;
  const profileFallback = useMemo(() => initials(accountName) || "C", [accountName]);
  const publicProfileHref = resolveCurrentPlayerStatus(currentPlayer) === "published" && currentPlayer
    ? `/${encodeURIComponent(currentPlayer.slug)}`
    : "/mi-flow";
  const cssVariables = useMemo(
    () => ({ ...configCssVariables(config), backgroundColor: config.theme.backgroundColor }) as CSSProperties,
    [config],
  );
  const heroImage = previewMode
    ? config.hero.imageUrl
    : currentPlayer?.cover_url || currentPlayer?.hero_image_url || VISUAL_ASSETS["player-public-profile-cover-01"];

  if ((user && !playerReady) || loading || (configLoading && !configOverride)) {
    return (
      <main className={styles.loading} aria-busy={loading || playerLoading || configLoading} aria-label="Cargando CLOUVA">
        <CloverIcon size={34} />
      </main>
    );
  }

  const preventPreviewNavigation = (event: MouseEvent<HTMLElement>) => {
    if (previewMode) event.preventDefault();
  };
  const openMusic = () => {
    if (!previewMode) router.push("/mi-flow/music");
  };

  function renderHero() {
    return (
      <section
        key="hero"
        className={styles.hero}
        aria-labelledby="mobile-home-title"
        style={{ backgroundImage: `url(${heroImage})` }}
        data-clouva-block="hero"
      >
        <div className={styles.heroShade} aria-hidden="true" />
        <div className={styles.heroContent}>
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
    return (
      <section key="music" className={styles.musicCard} aria-label={`${config.music.title}, ${config.music.artist}`} data-clouva-block="music">
        <button type="button" className={styles.musicCover} onClick={openMusic} aria-label={`Abrir ${config.music.title}`}>
          <img src={config.music.coverUrl} alt={`Portada de ${config.music.title}`} />
        </button>

        <div className={styles.musicPanel}>
          <div className={styles.musicHeading}>
            <div>
              <h2>{config.music.title}</h2>
              <p>{config.music.artist}</p>
              {!previewMode ? <SpotifyHomeConnectAction /> : null}
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
          <div className={styles.musicTimes}><span>{config.music.currentTime}</span><span>{config.music.duration}</span></div>

          <div className={styles.musicControls}>
            <button type="button" onClick={openMusic} aria-label="Tema anterior"><SkipBack size={22} fill="currentColor" /></button>
            <button type="button" className={styles.playButton} onClick={openMusic} aria-label="Abrir reproductor"><Pause size={25} fill="currentColor" /></button>
            <button type="button" onClick={openMusic} aria-label="Tema siguiente"><SkipForward size={22} fill="currentColor" /></button>
          </div>
        </div>
      </section>
    );
  }

  function featureCard(id: "continue" | "iglu", card: MobileHomeCardConfig) {
    if (!card.visible) return null;
    return (
      <Link
        key={id}
        href={card.href}
        className={styles.featureCard}
        style={{ backgroundImage: `url(${card.imageUrl})` }}
        onClick={preventPreviewNavigation}
        data-clouva-block={id}
      >
        <span className={styles.featureShade} aria-hidden="true" />
        <div>
          <h2>{multiline(card.title)}</h2>
          <p>{multiline(card.body)}</p>
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
        <Link href="/" className={styles.brand} aria-label="Inicio de CLOUVA" onClick={preventPreviewNavigation}>
          <span className={styles.brandMark}><CloverIcon size={29} /></span>
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
              triggerImageUrl={config.header.showBrandAvatar ? config.header.brandAvatarUrl : undefined}
            />
          ) : config.header.showBrandAvatar ? (
            <span className={styles.brandAvatar} aria-hidden="true">
              <img src={config.header.brandAvatarUrl} alt="" />
            </span>
          ) : null}
        </div>
      </header>

      {config.sections.map((section) => sectionRenderers[section]())}

      <nav className={styles.bottomNav} aria-label="Navegación principal móvil" data-clouva-block="navigation">
        <Link href="/" className={styles.activeNav} onClick={preventPreviewNavigation}>
          <Home size={22} fill="currentColor" />
          <span>{config.navigation.homeLabel}</span>
        </Link>
        <Link href="/mi-flow/avatar" onClick={preventPreviewNavigation}>
          <CircleUserRound size={23} />
          <span>{config.navigation.avatarLabel}</span>
        </Link>
        <Link href={role === "admin" ? "/crear" : "/creator-studio"} className={styles.createNav} aria-label={role === "admin" ? "Crear con CLOUVA" : "Crear en Creator Studio"} onClick={preventPreviewNavigation}>
          <b><Plus size={32} /></b>
          <small>{config.navigation.createLabel}</small>
        </Link>
        <Link href="/tienda" onClick={preventPreviewNavigation}>
          <ShoppingBag size={23} />
          <span>{config.navigation.marketplaceLabel}</span>
        </Link>
        <Link href={publicProfileHref} className={styles.profileNav} aria-label="Abrir mi Player" onClick={preventPreviewNavigation}>
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
