"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties, MouseEvent } from "react";
import {
  ArrowRight,
  Bell,
  CircleUserRound,
  Crown,
  Home,
  Pause,
  Play,
  Plus,
  ShoppingBag,
  SkipForward,
  Sparkles,
  WalletCards,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { useCurrentPlayer } from "@/components/current-player-provider";
import { AccountMenu } from "@/components/account/AccountMenu";
import { useSpotifyPlayback } from "@/components/music/SpotifyPlaybackProvider";
import { OfficialClouvaMark } from "@/components/clouva/OfficialClouvaMark";
import { WalletBalanceChip } from "@/components/wallet/WalletBalanceChip";
import { resolveAccountDisplayName } from "@/lib/identity-names";
import {
  CLOUVA_NAVIGATION,
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
import styles from "./mobile-home-premium.module.css";
import labStyles from "./mobile-home-lab.module.css";

const [homeNav, , createNav, marketNav, miFlowNav] = getNavigationItems(MOBILE_PRIMARY_NAV_KEYS);

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
    () => ({ ...configCssVariables(config), backgroundColor: "#050507" }) as CSSProperties,
    [config],
  );

  const preventPreviewNavigation = (event: MouseEvent<HTMLElement>) => {
    if (previewMode) event.preventDefault();
  };

  const openMusic = () => {
    if (!previewMode) router.push("/mi-flow/music");
  };

  const runPlayback = (action: "play" | "pause" | "next") => {
    if (previewMode || !playback || !scopesReady) {
      openMusic();
      return;
    }
    void controlPlayback(action).catch(() => undefined);
  };

  function renderHero() {
    return (
      <section key="hero" className={styles.hero} aria-labelledby="mobile-home-title" data-clouva-block="hero">
        <div className={styles.heroAtmosphere} aria-hidden="true">
          <span className={styles.heroHalo} />
          <span className={styles.heroOrbitOne} />
          <span className={styles.heroOrbitTwo} />
          <span className={styles.heroStarOne} />
          <span className={styles.heroStarTwo} />
          <span className={styles.heroStarThree} />
        </div>

        <div className={styles.heroIdentity} aria-hidden="true">
          <span className={styles.identityRing} />
          <span className={styles.identityCore}>
            {playerImage ? (
              <img src={playerImage} alt="" />
            ) : (
              <OfficialClouvaMark tone="light" className={styles.identityMark} />
            )}
          </span>
        </div>

        <div className={styles.heroContent}>
          <span className={styles.eyebrow}>{config.hero.eyebrow}</span>
          <h1 id="mobile-home-title">{multiline(config.hero.title)}</h1>
          <p>{config.hero.subtitle}</p>

          <div className={styles.heroActions}>
            <Link href={config.hero.primaryHref} className={styles.primaryAction} onClick={preventPreviewNavigation}>
              <CircleUserRound size={17} />
              {config.hero.primaryLabel}
            </Link>
            <Link href={config.hero.secondaryHref} className={styles.secondaryAction} onClick={preventPreviewNavigation}>
              <Sparkles size={16} />
              {config.hero.secondaryLabel}
            </Link>
          </div>
        </div>

        <div className={styles.flowPanel} data-clouva-block="wallet">
          <div className={styles.flowCopy}>
            <small>MI FLOW</small>
            <strong>Tu moneda dentro de CLOUVA</strong>
          </div>
          <div className={styles.flowBalance}>
            {!previewMode ? <WalletBalanceChip /> : <span className={styles.flowPreview}>FLOWS</span>}
            <Link
              href="/mi-flow/billetera?asset=flows"
              aria-label="Abrir mi billetera de FLOWS"
              onClick={preventPreviewNavigation}
            >
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>
    );
  }

  function renderMusic() {
    if (!config.music.visible || !playback?.isPlaying) return null;

    const { track } = playback;
    const progress = playback.durationMs
      ? Math.min(100, Math.max(0, (playback.progressMs / playback.durationMs) * 100))
      : 0;

    return (
      <section
        key="music"
        className={styles.nowPlaying}
        aria-label={`Escuchando ${track.title}, ${track.artist}`}
        data-clouva-block="music"
      >
        <button type="button" className={styles.nowPlayingMain} onClick={openMusic} aria-label="Abrir música">
          <span className={styles.nowPlayingCover}>
            {track.coverUrl ? <img src={track.coverUrl} alt="" /> : <span className={styles.spotifyFallback}>S</span>}
          </span>
          <span className={styles.nowPlayingCopy}>
            <small><i aria-hidden="true" /> ESCUCHANDO EN SPOTIFY</small>
            <strong>{track.title}</strong>
            <em>{track.artist}</em>
          </span>
        </button>

        <div className={styles.nowPlayingControls}>
          <button
            type="button"
            onClick={() => runPlayback("pause")}
            disabled={Boolean(busyAction)}
            aria-label="Pausar Spotify"
          >
            <Pause size={17} fill="currentColor" />
          </button>
          <button
            type="button"
            onClick={() => runPlayback("next")}
            disabled={Boolean(busyAction)}
            aria-label="Siguiente tema"
          >
            <SkipForward size={17} fill="currentColor" />
          </button>
        </div>

        <div className={styles.nowPlayingProgress} aria-hidden="true">
          <span><i style={{ width: `${progress}%` }} /></span>
          <small>{formatTime(playback.progressMs)} / {formatTime(playback.durationMs)}</small>
        </div>
      </section>
    );
  }

  function featureCard(id: "continue" | "iglu", card: MobileHomeCardConfig) {
    if (!card.visible) return null;

    const isVip = id === "continue";
    const href = isVip ? "/vip" : CLOUVA_NAVIGATION.MI_SPOT.href;
    const title = isVip ? "Desbloqueá funciones VIP" : "Entrar a mi Spot";
    const body = isVip
      ? "Más herramientas, identidad y experiencias dentro de CLOUVA."
      : "Tu espacio. Tu música. Tu universo.";

    return (
      <Link
        key={id}
        href={href}
        className={`${styles.featureCard} ${isVip ? styles.vipCard : styles.spotCard}`}
        style={!isVip ? { backgroundImage: `url(${card.imageUrl})` } : undefined}
        onClick={preventPreviewNavigation}
        data-clouva-block={id}
      >
        <span className={styles.featureSurface} aria-hidden="true" />
        <div className={styles.featureTop}>
          <span className={styles.featureIcon}>
            {isVip ? <Crown size={17} /> : <OfficialClouvaMark tone="light" className={styles.spotMark} />}
          </span>
          <small>{isVip ? "CLOUVA VIP" : "MI SPOT"}</small>
        </div>
        <div className={styles.featureBody}>
          <h2>{title}</h2>
          <p>{body}</p>
        </div>
        <b className={styles.featureArrow} aria-hidden="true"><ArrowRight size={17} /></b>
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
          <span className={styles.brandMark}>
            <OfficialClouvaMark tone="light" className={styles.brandMarkImage} />
          </span>
          <span className={styles.brandCopy}>
            <strong>{config.header.logoText}</strong>
            <small>VIDA DE FLOWS</small>
          </span>
        </Link>

        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.notificationButton}
            onClick={() => setNotificationsOpen(true)}
            aria-label="Abrir notificaciones"
            aria-expanded={notificationsOpen}
          >
            <Bell size={20} />
            {config.header.showNotificationDot ? <span aria-hidden="true" /> : null}
          </button>
          {!previewMode ? (
            <AccountMenu
              variant="home"
              triggerImageUrl={playerImage ?? undefined}
            />
          ) : playerImage ? (
            <span className={styles.brandAvatar} aria-hidden="true"><img src={playerImage} alt="" /></span>
          ) : config.header.showBrandAvatar ? (
            <span className={styles.brandAvatar} aria-hidden="true"><img src={config.header.brandAvatarUrl} alt="" /></span>
          ) : null}
        </div>
      </header>

      <section className={styles.playerLine} aria-label="Player activo">
        <Link href={publicProfileHref} onClick={preventPreviewNavigation}>
          <span className={styles.playerMiniAvatar}>
            {playerImage ? <img src={String(playerImage)} alt="" /> : <b>{profileFallback}</b>}
          </span>
          <span>
            <small>PLAYER ACTIVO</small>
            <strong>{playerDisplayName}</strong>
          </span>
          <ArrowRight size={15} />
        </Link>
      </section>

      <div className={styles.sections}>
        {config.sections.map((section) => sectionRenderers[section]())}
      </div>

      <nav className={styles.bottomNav} aria-label="Navegación principal móvil" data-clouva-block="navigation">
        <Link href={homeNav.href} className={styles.activeNav} onClick={preventPreviewNavigation}>
          <Home size={20} fill="currentColor" />
          <span>{homeNav.label}</span>
        </Link>
        <Link href={publicProfileHref} className={styles.profileNav} aria-label={`Abrir Player de ${playerDisplayName}`} onClick={preventPreviewNavigation}>
          {playerImage ? <img src={String(playerImage)} alt="" /> : <b>{profileFallback}</b>}
          <span>Player</span>
        </Link>
        <Link href={createNav.href} className={styles.createNav} aria-label="Crear en CLOUVA" onClick={preventPreviewNavigation}>
          <b><Plus size={27} /></b>
          <small>{createNav.label}</small>
        </Link>
        <Link href={marketNav.href} onClick={preventPreviewNavigation}>
          <ShoppingBag size={20} />
          <span>{marketNav.label}</span>
        </Link>
        <Link href={miFlowNav.href} aria-label="Abrir Mi Flow" onClick={preventPreviewNavigation}>
          <WalletCards size={20} />
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
                <X size={19} />
              </button>
            </header>
            <div className={styles.emptyNotifications}>
              <Bell size={24} />
              <strong>Todo al día</strong>
              <p>No tenés notificaciones nuevas.</p>
            </div>
          </aside>
        </div>
      ) : null}
    </main>
  );
}
