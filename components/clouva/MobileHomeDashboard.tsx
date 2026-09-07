"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties, MouseEvent } from "react";
import {
  ArrowRight,
  BarChart3,
  Bell,
  CircleUserRound,
  Crown,
  Diamond,
  Home,
  Music2,
  Pause,
  Plus,
  ShoppingBag,
  SkipForward,
  Sparkles,
  Star,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { useCurrentPlayer } from "@/components/current-player-provider";
import { AccountMenu } from "@/components/account/AccountMenu";
import { useSpotifyPlayback } from "@/components/music/SpotifyPlaybackProvider";
import { OfficialClouvaMark } from "@/components/clouva/OfficialClouvaMark";
import { GlobalFlowBalance } from "@/components/GlobalFlowBalance";
import { resolveAccountDisplayName } from "@/lib/identity-names";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { VISUAL_ASSETS } from "@/lib/visual-assets";
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
const MOBILE_HOME_ORBITS_ASSET_URL = VISUAL_ASSETS["home-mobile-player-orbits-01"];

type VipState = {
  entitlement: null | {
    tier: string;
    status: string;
  };
};

type HomeVisualAssets = {
  vipComplete: string | null;
  vipPedestal: string | null;
  playerRing: string | null;
  vipCrown: string | null;
  vipCompleteAlt: string | null;
  playerOrbits: string | null;
};

type HomeVisualAssetsResponse = {
  assets: HomeVisualAssets;
};

const EMPTY_HOME_VISUAL_ASSETS: HomeVisualAssets = {
  vipComplete: null,
  vipPedestal: null,
  playerRing: null,
  vipCrown: null,
  vipCompleteAlt: null,
  playerOrbits: null,
};

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
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
  const { user, profile, session, loading: authLoading } = useAuth();
  const { currentPlayer } = useCurrentPlayer();
  const { playback, scopesReady, busyAction, controlPlayback } = useSpotifyPlayback();
  const { config, version } = usePublishedUiPage(
    "mobile-home",
    DEFAULT_MOBILE_HOME_CONFIG,
    sanitizeMobileHomeConfig,
    configOverride,
  );
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [vipActive, setVipActive] = useState(false);
  const [homeVisualAssets, setHomeVisualAssets] = useState<HomeVisualAssets>(EMPTY_HOME_VISUAL_ASSETS);

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
    () => ({ ...configCssVariables(config), backgroundColor: "#030207" }) as CSSProperties,
    [config],
  );
  const playerOrbitsAsset = homeVisualAssets.playerOrbits || MOBILE_HOME_ORBITS_ASSET_URL;

  useEffect(() => {
    if (previewMode || authLoading) return;
    let cancelled = false;

    const loadVip = async () => {
      try {
        const response = session
          ? await authenticatedFetch("/api/billing/vip")
          : await fetch("/api/billing/vip", { cache: "no-store" });
        const state = await readApiJson<VipState>(response);
        if (!cancelled) {
          setVipActive(state.entitlement?.tier === "vip" && state.entitlement.status === "active");
        }
      } catch {
        if (!cancelled) setVipActive(false);
      }
    };

    void loadVip();
    return () => { cancelled = true; };
  }, [authLoading, previewMode, session?.access_token]);

  useEffect(() => {
    let cancelled = false;

    const loadHomeVisualAssets = async () => {
      try {
        const response = await fetch("/api/home/visual-assets", { cache: "force-cache" });
        if (!response.ok) return;
        const payload = await response.json() as HomeVisualAssetsResponse;
        if (!cancelled && payload?.assets) {
          setHomeVisualAssets({ ...EMPTY_HOME_VISUAL_ASSETS, ...payload.assets });
        }
      } catch {
        // Keep the current visual fallbacks if the generated-asset resolver is unavailable.
      }
    };

    void loadHomeVisualAssets();
    return () => { cancelled = true; };
  }, []);

  const preventPreviewNavigation = (event: MouseEvent<HTMLElement>) => {
    if (previewMode) event.preventDefault();
  };

  const openMusic = () => {
    if (!previewMode) router.push("/mi-flow/music");
  };

  const runPlayback = (action: "pause" | "next") => {
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
        data-clouva-block="hero"
      >
        <div
          className={styles.heroBackdrop}
          style={{ backgroundImage: `url(${config.hero.imageUrl})` }}
          aria-hidden="true"
        />
        <div className={styles.heroAtmosphere} aria-hidden="true">
          <span className={styles.heroHalo} />
          <span className={styles.heroStarOne} />
          <span className={styles.heroStarTwo} />
          <span className={styles.heroStarThree} />
          <span className={styles.heroStarFour} />
        </div>

        <div className={styles.heroSideWords} aria-hidden="true">
          <span>GENTE</span>
          <span>MÚSICA</span>
          <span>MUNDOS</span>
          <span>IDEAS</span>
          <span>VOS</span>
        </div>

        <Link
          href="/clouva-ai"
          className={styles.aiPortal}
          onClick={preventPreviewNavigation}
          aria-label="Abrir CLOUVA AI"
        >
          <span className={styles.aiOrb}><Sparkles size={21} /></span>
          <small>CLOUVA AI</small>
          <b>SIEMPRE<br />CON VOS <ArrowRight size={10} /></b>
        </Link>

        <div className={styles.heroIdentity}>
          <img
            src={playerOrbitsAsset}
            alt=""
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              zIndex: 0,
              width: "300px",
              height: "300px",
              maxWidth: "none",
              objectFit: "contain",
              pointerEvents: "none",
              userSelect: "none",
              transform: "translate(-50%, -50%)",
              filter: "drop-shadow(0 0 18px rgba(184, 71, 255, 0.42))",
            }}
          />
          {homeVisualAssets.playerRing ? (
            <img
              src={homeVisualAssets.playerRing}
              alt=""
              aria-hidden="true"
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                zIndex: 1,
                width: "205px",
                height: "205px",
                maxWidth: "none",
                objectFit: "contain",
                pointerEvents: "none",
                userSelect: "none",
                transform: "translate(-50%, -50%)",
                filter: "drop-shadow(0 0 22px rgba(191, 75, 255, 0.68))",
              }}
            />
          ) : (
            <span className={styles.identityRing} aria-hidden="true" style={{ zIndex: 1 }} />
          )}
          <span className={styles.identityCore} style={{ position: "relative", zIndex: 2 }}>
            {playerImage ? (
              <img src={playerImage} alt={`Foto de ${playerDisplayName}`} />
            ) : (
              <OfficialClouvaMark tone="light" className={styles.identityMark} />
            )}
          </span>
        </div>

        <div className={styles.heroContent}>
          <span className={styles.eyebrow}>BIENVENIDO DE NUEVO</span>
          <h1 id="mobile-home-title">VIDA DE FLOWS</h1>
          <p>Viví tu propio mundo.</p>

          <div className={styles.heroActions}>
            <Link href={publicProfileHref} className={styles.primaryAction} onClick={preventPreviewNavigation}>
              <CircleUserRound size={19} />
              <span>Entrar a mi perfil</span>
              <ArrowRight size={17} />
            </Link>
            <Link href={config.hero.secondaryHref} className={styles.secondaryAction} onClick={preventPreviewNavigation}>
              <Sparkles size={18} />
              <span>Explorar Mundos</span>
              <ArrowRight size={17} />
            </Link>
          </div>

          <div className={styles.heroMantra} aria-hidden="true">
            <span>CREÁ</span><i />
            <span>CONECTÁ</span><i />
            <span>EXPLORÁ</span><i />
            <span>VIVÍ</span>
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

    if (isVip) {
      const hasVipPieces = Boolean(homeVisualAssets.vipCrown && homeVisualAssets.vipPedestal);
      const vipCompleteAsset = homeVisualAssets.vipComplete || homeVisualAssets.vipCompleteAlt;

      return (
        <Link
          key={id}
          href={href}
          className={`${styles.featureCard} ${styles.vipCard}`}
          onClick={preventPreviewNavigation}
          data-clouva-block={id}
        >
          <span className={styles.featureSurface} aria-hidden="true" />
          {homeVisualAssets.vipCompleteAlt ? (
            <img
              src={homeVisualAssets.vipCompleteAlt}
              alt=""
              aria-hidden="true"
              style={{
                position: "absolute",
                top: "72px",
                right: "-46px",
                zIndex: 1,
                width: "188px",
                height: "188px",
                maxWidth: "none",
                objectFit: "contain",
                opacity: 0.11,
                pointerEvents: "none",
                userSelect: "none",
                filter: "blur(0.2px) drop-shadow(0 0 28px rgba(177, 62, 255, 0.46))",
              }}
            />
          ) : null}
          <div className={styles.featureTop}>
            <span className={`${styles.featureIcon} ${styles.vipIcon}`}>
              {homeVisualAssets.vipCrown ? (
                <img
                  src={homeVisualAssets.vipCrown}
                  alt=""
                  aria-hidden="true"
                  style={{ width: "30px", height: "30px", objectFit: "contain" }}
                />
              ) : (
                <Crown size={21} />
              )}
            </span>
            <strong>CLOUVA VIP</strong>
            {vipActive ? <em className={styles.vipActive}><i /> VIP ACTIVO <i /></em> : null}
          </div>

          <div className={styles.vipBody}>
            <h2>Potenciá<br />tu experiencia</h2>
            <p>Más herramientas, identidad y experiencias exclusivas dentro de CLOUVA.</p>
          </div>

          <div className={styles.vipVisual} aria-hidden="true">
            {hasVipPieces ? (
              <>
                <img
                  src={homeVisualAssets.vipPedestal!}
                  alt=""
                  style={{
                    position: "absolute",
                    right: "-10px",
                    bottom: "0px",
                    width: "122px",
                    height: "122px",
                    maxWidth: "none",
                    objectFit: "contain",
                    filter: "drop-shadow(0 0 14px rgba(215, 62, 255, 0.62))",
                  }}
                />
                <img
                  src={homeVisualAssets.vipCrown!}
                  alt=""
                  style={{
                    position: "absolute",
                    top: "-3px",
                    right: "16px",
                    width: "72px",
                    height: "72px",
                    maxWidth: "none",
                    objectFit: "contain",
                    filter: "drop-shadow(0 0 11px rgba(255, 178, 47, 0.72))",
                  }}
                />
              </>
            ) : vipCompleteAsset ? (
              <img
                src={vipCompleteAsset}
                alt=""
                style={{
                  width: "132px",
                  height: "145px",
                  maxWidth: "none",
                  objectFit: "contain",
                  filter: "drop-shadow(0 0 14px rgba(200, 69, 255, 0.58))",
                }}
              />
            ) : (
              <>
                <span className={styles.vipBeam} />
                <span className={styles.vipPedestal} />
                <Crown size={44} />
              </>
            )}
          </div>

          <span className={styles.vipCta}>Ver beneficios VIP <ArrowRight size={16} /></span>

          <div className={styles.featureBenefits} aria-hidden="true">
            <span><Diamond size={15} /><small>MÁS<br />HERRAMIENTAS</small></span>
            <span><Users size={15} /><small>EXPERIENCIAS<br />EXCLUSIVAS</small></span>
            <span><Star size={15} /><small>IDENTIDAD<br />ÚNICA</small></span>
          </div>
        </Link>
      );
    }

    return (
      <Link
        key={id}
        href={href}
        className={`${styles.featureCard} ${styles.spotCard}`}
        style={{ backgroundImage: `url(${card.imageUrl})` }}
        onClick={preventPreviewNavigation}
        data-clouva-block={id}
      >
        <span className={styles.featureSurface} aria-hidden="true" />
        <div className={styles.featureTop}>
          <span className={styles.featureIcon}>
            <OfficialClouvaMark tone="light" className={styles.spotMark} />
          </span>
          <strong>MI SPOT</strong>
        </div>
        <span className={styles.featureArrow} aria-hidden="true"><ArrowRight size={18} /></span>
        <div className={styles.spotBody}>
          <h2>Entrar a mi Spot</h2>
          <p>Tu espacio. Tu música. Tu universo.</p>
        </div>
        <div className={styles.featureBenefits} aria-hidden="true">
          <span><Music2 size={15} /><small>CREÁ</small></span>
          <span><BarChart3 size={15} /><small>COMPARTÍ</small></span>
          <span><Users size={15} /><small>CONECTÁ</small></span>
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
          <span className={styles.brandMark}>
            <OfficialClouvaMark tone="light" className={styles.brandMarkImage} />
          </span>
          <span className={styles.brandCopy}>
            <strong>{config.header.logoText}</strong>
            <small>VIDA DE FLOWS</small>
          </span>
        </Link>

        <div className={styles.headerActions}>
          {!previewMode ? <GlobalFlowBalance variant="header" /> : null}
          <button
            type="button"
            className={styles.notificationButton}
            onClick={() => setNotificationsOpen(true)}
            aria-label="Abrir notificaciones"
            aria-expanded={notificationsOpen}
          >
            <Bell size={21} />
            {config.header.showNotificationDot ? <span aria-hidden="true" /> : null}
          </button>
          {!previewMode ? (
            <AccountMenu variant="home" triggerImageUrl={playerImage ?? undefined} />
          ) : playerImage ? (
            <span className={styles.brandAvatar} aria-hidden="true"><img src={playerImage} alt="" /></span>
          ) : config.header.showBrandAvatar ? (
            <span className={styles.brandAvatar} aria-hidden="true"><img src={config.header.brandAvatarUrl} alt="" /></span>
          ) : null}
        </div>
      </header>

      <section className={styles.playerStatus} aria-label="Player activo">
        <Link href={publicProfileHref} className={styles.playerLine} onClick={preventPreviewNavigation}>
          <span className={styles.playerMiniAvatar}>
            {playerImage ? <img src={String(playerImage)} alt="" /> : <b>{profileFallback}</b>}
          </span>
          <span className={styles.playerLineCopy}>
            <small>PLAYER ACTIVO</small>
            <strong>{playerDisplayName}</strong>
          </span>
          <ArrowRight size={18} />
        </Link>

        <div className={styles.playerState} aria-label="Estado del Player: activo">
          <i aria-hidden="true" />
          <span><small>PLAYER</small><strong>Activo</strong></span>
        </div>
        <p className={styles.playerTagline}>Más música.<br />Más mundos.<br />Más vos.</p>
      </section>

      <div className={styles.sections}>
        {config.sections.map((section) => sectionRenderers[section]())}
      </div>

      <nav className={styles.bottomNav} aria-label="Navegación principal móvil" data-clouva-block="navigation">
        <Link href={homeNav.href} className={styles.activeNav} onClick={preventPreviewNavigation}>
          <Home size={21} fill="currentColor" />
          <span>{homeNav.label}</span>
        </Link>
        <Link href={publicProfileHref} className={styles.profileNav} aria-label={`Abrir Player de ${playerDisplayName}`} onClick={preventPreviewNavigation}>
          {playerImage ? <img src={String(playerImage)} alt="" /> : <b>{profileFallback}</b>}
          <span>Player</span>
        </Link>
        <Link href={createNav.href} className={styles.createNav} aria-label="Crear en CLOUVA" onClick={preventPreviewNavigation}>
          <b><Plus size={31} /></b>
          <small>{createNav.label}</small>
        </Link>
        <Link href={marketNav.href} onClick={preventPreviewNavigation}>
          <ShoppingBag size={21} />
          <span>{marketNav.label}</span>
        </Link>
        <Link href={miFlowNav.href} aria-label="Abrir Mi Flow" onClick={preventPreviewNavigation}>
          <WalletCards size={21} />
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
