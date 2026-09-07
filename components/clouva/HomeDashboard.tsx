"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  CircleUserRound,
  Compass,
  DollarSign,
  Home,
  LayoutGrid,
  Music2,
  Pause,
  Play,
  ShoppingBag,
  SkipBack,
  SkipForward,
  Sparkles,
  Store,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { useCurrentPlayer } from "@/components/current-player-provider";
import { useClouvaAIAssistant } from "@/components/clouva-ai/ClouvaAIAssistantProvider";
import { SpotifyHomeStatus } from "@/components/music/SpotifyHomeStatus";
import { useSpotifyPlayback } from "@/components/music/SpotifyPlaybackProvider";
import { resolveHomeDisplayName } from "@/lib/identity-names";
import {
  CLOUVA_NAVIGATION,
  DESKTOP_PRIMARY_NAV_KEYS,
  getNavigationItems,
  getPlayerDestination,
  type ClouvaSurfaceKey,
} from "@/lib/navigation/clouva-navigation";
import { VISUAL_ASSETS } from "@/lib/visual-assets";
import styles from "./home-dashboard.module.css";

const PLAYER_ORBITS_ASSET = VISUAL_ASSETS["home-mobile-player-orbits-01"];

const navigationIcons: Partial<Record<ClouvaSurfaceKey, typeof Home>> = {
  HOME: Home,
  CREATE: Sparkles,
  MARKET: ShoppingBag,
  MATRIX: LayoutGrid,
};

const primaryNav = getNavigationItems(DESKTOP_PRIMARY_NAV_KEYS).map((item) => ({
  ...item,
  icon: navigationIcons[item.key] ?? Home,
}));

type HomeVisualAssets = {
  vipComplete: string | null;
  vipPedestal: string | null;
  playerRing: string | null;
  vipCrown: string | null;
  vipCompleteAlt: string | null;
  playerOrbits: string | null;
  heroStudio: string | null;
  cardPlayer: string | null;
  cardFlow: string | null;
  cardCreator: string | null;
  cardSpot: string | null;
  cardMarket: string | null;
  matrixBackground: string | null;
  flowCoin: string | null;
};

type HomeCardAssetKey = "cardPlayer" | "cardFlow" | "cardCreator" | "cardSpot" | "cardMarket";

const EMPTY_HOME_VISUAL_ASSETS: HomeVisualAssets = {
  vipComplete: null,
  vipPedestal: null,
  playerRing: null,
  vipCrown: null,
  vipCompleteAlt: null,
  playerOrbits: null,
  heroStudio: null,
  cardPlayer: null,
  cardFlow: null,
  cardCreator: null,
  cardSpot: null,
  cardMarket: null,
  matrixBackground: null,
  flowCoin: null,
};

const homeModules = [
  {
    key: "PLAYER" as const,
    assetKey: "cardPlayer" as HomeCardAssetKey,
    title: "Mi Player",
    description: "Tu identidad pública, tu página y tu presencia dentro de CLOUVA.",
    cta: "Abrir Player",
    icon: CircleUserRound,
  },
  {
    key: "MI_FLOW" as const,
    assetKey: "cardFlow" as HomeCardAssetKey,
    title: "Mi Flow",
    description: "Billetera, FLOWs, ingresos, balances, objetivos y movimientos.",
    cta: "Abrir Mi Flow",
    icon: DollarSign,
  },
  {
    key: "CREATE" as const,
    assetKey: "cardCreator" as HomeCardAssetKey,
    title: "Crear",
    description: "Imagen, video, Trébol, Creator Studio 3D, avatar, ropa y herramientas creativas.",
    cta: "Crear",
    icon: Sparkles,
  },
  {
    key: "MI_SPOT" as const,
    assetKey: "cardSpot" as HomeCardAssetKey,
    title: "Mi Spot",
    description: "Los negocios, Spots, marcas, clubes y Studios que manejás.",
    cta: "Abrir Mi Spot",
    icon: Store,
  },
  {
    key: "MARKET" as const,
    assetKey: "cardMarket" as HomeCardAssetKey,
    title: "Market",
    description: "Descubrí productos, servicios, merch físico y digital dentro de CLOUVA.",
    cta: "Ir al Market",
    icon: ShoppingBag,
  },
];

function formatTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function HomeDashboard() {
  const { user, profile } = useAuth();
  const { currentPlayer } = useCurrentPlayer();
  const { openAssistant } = useClouvaAIAssistant();
  const {
    playback,
    connected: spotifyConnected,
    scopesReady: spotifyScopesReady,
    busyAction,
    controlPlayback,
  } = useSpotifyPlayback();
  const [homeVisualAssets, setHomeVisualAssets] = useState<HomeVisualAssets>(EMPTY_HOME_VISUAL_ASSETS);
  const [homeVisualAssetsResolved, setHomeVisualAssetsResolved] = useState(false);

  const displayName = resolveHomeDisplayName({ currentPlayer, profile, user });
  const username = currentPlayer?.username
    ? `@${currentPlayer.username.replace(/^@/, "")}`
    : profile?.username
      ? `@${profile.username.replace(/^@/, "")}`
      : user
        ? "Tu identidad CLOUVA"
        : "Explorá tu propio mundo";
  const railIdentityImage = currentPlayer?.profile_image_url
    || currentPlayer?.logo_url
    || profile?.avatar_url
    || user?.user_metadata?.avatar_url
    || null;
  const fallbackHeroImage = currentPlayer?.cover_url || currentPlayer?.hero_image_url || VISUAL_ASSETS["player-public-profile-cover-01"];
  const isSignedIn = Boolean(user);
  const playerHref = getPlayerDestination(currentPlayer);
  const heroBackground = homeVisualAssets.heroStudio || (homeVisualAssetsResolved ? fallbackHeroImage : null);
  const desktopVipArtwork = homeVisualAssets.vipCompleteAlt || homeVisualAssets.vipComplete;
  const spotifyControlsReady = Boolean(spotifyConnected && spotifyScopesReady && playback);
  const playbackProgress = playback?.durationMs
    ? Math.min(100, Math.max(0, (playback.progressMs / playback.durationMs) * 100))
    : 0;

  const workspaceNav = [
    { label: "Mi Player", href: playerHref, icon: CircleUserRound },
    { label: "Mi Flow", href: CLOUVA_NAVIGATION.MI_FLOW.href, icon: DollarSign },
    { label: "Mi Spot", href: CLOUVA_NAVIGATION.MI_SPOT.href, icon: Store },
  ];

  const effectiveModules = homeModules.map((item) => ({
    ...item,
    href: item.key === "PLAYER" ? playerHref : CLOUVA_NAVIGATION[item.key].href,
    artwork: homeVisualAssets[item.assetKey],
  }));

  const runPlaybackAction = (action: "play" | "pause" | "next" | "previous") => {
    if (!spotifyControlsReady || busyAction) return;
    void controlPlayback(action).catch(() => undefined);
  };

  useEffect(() => {
    let cancelled = false;

    const loadHomeVisualAssets = async () => {
      try {
        const response = await fetch("/api/home/visual-assets?schema=home-desktop-v2", { cache: "no-store" });
        if (!response.ok) {
          if (!cancelled) setHomeVisualAssetsResolved(true);
          return;
        }
        const payload = await response.json() as { assets?: Partial<HomeVisualAssets> };
        if (!cancelled) {
          if (payload.assets) {
            setHomeVisualAssets({ ...EMPTY_HOME_VISUAL_ASSETS, ...payload.assets });
          }
          setHomeVisualAssetsResolved(true);
        }
      } catch {
        if (!cancelled) setHomeVisualAssetsResolved(true);
      }
    };

    void loadHomeVisualAssets();
    return () => { cancelled = true; };
  }, []);

  return (
    <main className={styles.page}>
      <div className={styles.ambient} aria-hidden="true" />

      <aside className={styles.sidebar}>
        <nav className={styles.sideNav} aria-label="Secciones principales de CLOUVA">
          {primaryNav.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={item.key === "HOME" ? styles.sideNavActive : undefined}>
                <Icon size={17} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <section className={styles.workspaceSection}>
          <span className={styles.workspaceLabel}>TU ESPACIO</span>
          <nav className={styles.workspaceNav} aria-label="Tu espacio en CLOUVA">
            {workspaceNav.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <Icon size={17} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </section>

        <button type="button" className={styles.aiStatus} onClick={() => openAssistant()}>
          <span className={styles.aiMascot}><Image src="/assets/clouva-ai/trebol-mascot.png" alt="" width={40} height={40} /></span>
          <span className={styles.aiStatusCopy}>
            <b>CLOUVA AI</b>
            <small><i /> Lista para ayudarte</small>
            <em>¿Qué hacemos hoy?</em>
          </span>
          <ArrowRight size={14} />
        </button>
      </aside>

      <section className={styles.content}>
        <section
          className={styles.hero}
          data-visual-asset="home-hero-studio-clean"
          style={heroBackground ? { backgroundImage: `url(${heroBackground})` } : undefined}
        >
          <div className={styles.heroShade} aria-hidden="true" />
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>{isSignedIn ? "BIENVENIDO DE NUEVO" : "BIENVENIDO A TU UNIVERSO"}</span>
            <h1>CLOUVA</h1>
            <p>Tu casa dentro de CLOUVA.<br />Creá, administrá y explorá desde acá.</p>
            <div className={styles.heroActions}>
              <Link href={playerHref}>
                <CircleUserRound size={17} />
                Mi Player
                <ArrowRight size={15} />
              </Link>
              <Link href={CLOUVA_NAVIGATION.MATRIX.href} className={styles.secondaryAction}>
                <Compass size={17} />
                Explorar La Matrix
              </Link>
            </div>
            <span className={styles.heroQuote}>“Del Sur para el mundo.”</span>
          </div>

          <button
            type="button"
            className={styles.heroAICompanion}
            onClick={() => openAssistant()}
            aria-label="Abrir CLOUVA AI"
          >
            <span className={styles.heroAISpeech}>¿Qué hacemos hoy, {displayName}?</span>
            <span className={styles.heroAIMascot}>
              <Image src="/assets/clouva-ai/trebol-mascot.png" alt="" width={72} height={72} />
            </span>
          </button>
        </section>

        <section className={styles.musicBar} aria-label="Spotify en CLOUVA">
          <div className={styles.cover}>
            {playback?.track.coverUrl ? (
              <img src={playback.track.coverUrl} alt="" />
            ) : (
              <Music2 size={21} />
            )}
          </div>

          <div className={styles.spotifyStatus}>
            <SpotifyHomeStatus />
          </div>

          <div className={styles.musicControls} aria-label="Controles de Spotify">
            <button
              type="button"
              onClick={() => runPlaybackAction("previous")}
              disabled={!spotifyControlsReady || Boolean(busyAction)}
              aria-label="Anterior"
            >
              <SkipBack size={16} />
            </button>
            <button
              type="button"
              className={styles.playButton}
              onClick={() => runPlaybackAction(playback?.isPlaying ? "pause" : "play")}
              disabled={!spotifyControlsReady || Boolean(busyAction)}
              aria-label={playback?.isPlaying ? "Pausar" : "Reproducir"}
            >
              {playback?.isPlaying ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <button
              type="button"
              onClick={() => runPlaybackAction("next")}
              disabled={!spotifyControlsReady || Boolean(busyAction)}
              aria-label="Siguiente"
            >
              <SkipForward size={16} />
            </button>
          </div>

          <div className={styles.musicProgress}>
            <div className={styles.musicProgressTrack} aria-hidden="true">
              <span style={{ width: `${playbackProgress}%` }} />
            </div>
            <span>
              {playback ? formatTime(playback.progressMs) : "0:00"}
              <i>·</i>
              {playback ? formatTime(playback.durationMs) : "0:00"}
            </span>
          </div>

          <div className={styles.musicPhrase}>Misma esencia,<br />más universo.</div>
          <Link className={styles.musicOpen} href="/mi-flow/music" aria-label="Abrir música"><ArrowRight size={17} /></Link>
        </section>

        <section className={styles.moduleGrid} aria-label="Puertas principales de CLOUVA">
          {effectiveModules.map((module) => {
            const Icon = module.icon;
            return (
              <Link key={module.key} href={module.href} className={styles.moduleCard} data-module={module.key}>
                {module.artwork ? <img className={styles.moduleArtwork} src={module.artwork} alt="" aria-hidden="true" /> : null}
                <span className={styles.moduleShade} aria-hidden="true" />
                <div className={styles.moduleCardContent}>
                  <span className={styles.moduleIcon}><Icon size={20} /></span>
                  <h2>{module.title}</h2>
                  <p>{module.description}</p>
                  <span className={styles.moduleCta}>{module.cta} <ArrowRight size={13} /></span>
                </div>
              </Link>
            );
          })}
        </section>
      </section>

      <aside className={styles.rail}>
        <Link
          href={playerHref}
          aria-label={`Abrir Player de ${displayName}`}
          className="flex w-full min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl px-1 py-2 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70"
          data-home-rail-player-identity
        >
          <span className="relative grid h-11 w-11 shrink-0 place-items-center">
            <span className="absolute inset-[7px] rounded-full bg-violet-500/20 blur-[8px]" aria-hidden="true" />
            <img
              src={PLAYER_ORBITS_ASSET}
              alt=""
              aria-hidden="true"
              draggable={false}
              className="pointer-events-none absolute left-1/2 top-1/2 h-[58px] w-[58px] max-w-none -translate-x-1/2 -translate-y-1/2 select-none object-contain drop-shadow-[0_0_8px_rgba(184,71,255,0.55)]"
            />
            <span className="relative z-[1] grid h-[34px] w-[34px] place-items-center overflow-hidden rounded-full border border-white/20 bg-[#100a17] shadow-[0_0_14px_rgba(142,61,236,0.3)]">
              {railIdentityImage ? (
                <img src={String(railIdentityImage)} alt="" className="h-full w-full object-cover" />
              ) : (
                <b className="text-[12px] font-extrabold text-white">{displayName.trim().charAt(0).toUpperCase() || "C"}</b>
              )}
            </span>
          </span>

          <span className="w-full min-w-0 text-center leading-none">
            <strong className="block truncate text-[11px] font-extrabold text-white">{displayName}</strong>
            <small className="mt-1 block truncate text-[9px] font-medium text-violet-200/60">{username}</small>
          </span>
        </Link>

        <Link href="/vip" className={styles.vipCard}>
          <span className={styles.vipLabel}>CLOUVA VIP</span>
          <h2>Potenciá tu experiencia.</h2>
          <p>Más herramientas, identidad y experiencias exclusivas.</p>
          <b>Ver VIP <ArrowRight size={13} /></b>
          {desktopVipArtwork ? (
            <img className={styles.vipArtwork} src={desktopVipArtwork} alt="" aria-hidden="true" />
          ) : homeVisualAssets.vipCrown ? (
            <img className={styles.vipCrown} src={homeVisualAssets.vipCrown} alt="" aria-hidden="true" />
          ) : null}
        </Link>

        <Link
          href={CLOUVA_NAVIGATION.MATRIX.href}
          className={styles.matrixTeaser}
          style={homeVisualAssets.matrixBackground ? { backgroundImage: `url(${homeVisualAssets.matrixBackground})` } : undefined}
        >
          <span className={styles.matrixShade} aria-hidden="true" />
          <div className={styles.matrixContent}>
            <span>LA MATRIX</span>
            <h2>Tu red creativa empieza acá.</h2>
            <p>Descubrí Players, Estudios y proyectos conectados.</p>
            <b>Explorar ahora <ArrowRight size={14} /></b>
          </div>
        </Link>

        <Link href={CLOUVA_NAVIGATION.MARKET.href} className={styles.quickLink}>
          <Store size={19} />
          <span><b>Últimos drops</b><small>Explorá CLOUVA Market</small></span>
          <ArrowRight size={15} />
        </Link>
      </aside>
    </main>
  );
}
