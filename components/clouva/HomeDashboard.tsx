"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Bell,
  Box,
  CircleUserRound,
  Compass,
  DollarSign,
  Home,
  LayoutGrid,
  Menu,
  Music2,
  Search,
  ShoppingBag,
  Sparkles,
  Store,
  UsersRound,
} from "lucide-react";
import { CloverIcon } from "@/components/clover-icon";
import { useAuth } from "@/components/auth-provider";
import { useCurrentPlayer } from "@/components/current-player-provider";
import { AccountMenu } from "@/components/account/AccountMenu";
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

const navigationIcons = {
  HOME: Home,
  CREATE: Sparkles,
  MARKET: ShoppingBag,
  MATRIX: LayoutGrid,
} satisfies Partial<Record<ClouvaSurfaceKey, typeof Home>>;

const primaryNav = getNavigationItems(DESKTOP_PRIMARY_NAV_KEYS).map((item) => ({
  ...item,
  icon: navigationIcons[item.key] ?? Home,
}));

const homeModules = [
  {
    key: "PLAYER" as const,
    title: "Mi Player",
    description: "Tu identidad pública, tu página y tu presencia dentro de CLOUVA.",
    cta: "Abrir Player",
    icon: CircleUserRound,
  },
  {
    key: "MI_FLOW" as const,
    title: "Mi Flow",
    description: "Billetera, FLOWS, ingresos, balances, objetivos y movimientos.",
    cta: "Abrir Mi Flow",
    icon: DollarSign,
  },
  {
    key: "CREATE" as const,
    title: "Crear",
    description: "Imagen, video, Trébol, Creator Studio 3D, avatar, ropa y herramientas creativas.",
    cta: "Crear",
    icon: Sparkles,
  },
  {
    key: "MI_SPOT" as const,
    title: "Mi Spot",
    description: "Los negocios, Spots, marcas, clubes y Studios que manejás.",
    cta: "Abrir Mi Spot",
    icon: Store,
  },
  {
    key: "MARKET" as const,
    title: "Market",
    description: "Descubrí productos, servicios, merch físico y comercio dentro de CLOUVA.",
    cta: "Ir al Market",
    icon: ShoppingBag,
  },
  {
    key: "MATRIX" as const,
    title: "Explorá La Matrix",
    description: "Players, Studios y proyectos que forman el ecosistema CLOUVA.",
    cta: "Explorar",
    icon: Compass,
  },
];

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function HomeDashboard() {
  const { user, profile } = useAuth();
  const { currentPlayer, playerLoading, playerReady } = useCurrentPlayer();
  const { openAssistant } = useClouvaAIAssistant();
  const { playback } = useSpotifyPlayback();

  if (user && !playerReady) {
    return <main className="min-h-screen bg-[#060612]" aria-busy={playerLoading} aria-label="Cargando tu identidad CLOUVA" />;
  }

  const displayName = resolveHomeDisplayName({ currentPlayer, profile, user });
  const username = currentPlayer?.username
    ? `@${currentPlayer.username.replace(/^@/, "")}`
    : profile?.username
      ? `@${profile.username.replace(/^@/, "")}`
      : user
        ? "Tu identidad CLOUVA"
        : "Explorá tu propio mundo";
  const identityAvatarImage = currentPlayer?.profile_image_url || profile?.avatar_url || user?.user_metadata?.avatar_url || null;
  const heroPlayerImage = currentPlayer?.cover_url || currentPlayer?.hero_image_url || VISUAL_ASSETS["player-public-profile-cover-01"];
  const isSignedIn = Boolean(user);
  const hasAvatar = Boolean(profile?.avatar_3d_url);
  const completedSteps = [isSignedIn, Boolean(profile?.username), hasAvatar].filter(Boolean).length;
  const progress = Math.round((completedSteps / 3) * 100);
  const playerHref = getPlayerDestination(currentPlayer);
  const effectiveModules = homeModules.map((item) => ({
    ...item,
    href: item.key === "PLAYER" ? playerHref : CLOUVA_NAVIGATION[item.key].href,
  }));

  return (
    <main className={styles.page}>
      <div className={styles.ambient} aria-hidden="true" />

      <header className={styles.topbar}>
        <Link href={CLOUVA_NAVIGATION.HOME.href} className={styles.wordmark}>
          <span className={styles.brandIcon}><CloverIcon size={23} /></span>
          <span>CLOUVA</span>
        </Link>

        <nav className={styles.topnav} aria-label="Navegación principal">
          {primaryNav.map((item) => (
            <Link key={item.href} href={item.href} className={item.key === "HOME" ? styles.topnavActive : undefined}>{item.label}</Link>
          ))}
        </nav>

        <div className={styles.topActions}>
          <button type="button" aria-label="Buscar"><Search size={18} /></button>
          <button type="button" aria-label="Notificaciones"><Bell size={18} /></button>
          <AccountMenu variant="home" triggerClassName={styles.accountPill} />
          <button type="button" className={styles.mobileMenu} aria-label="Abrir menú"><Menu size={20} /></button>
        </div>
      </header>

      <aside className={styles.sidebar}>
        <section className={styles.identityCard}>
          <div className={styles.identityAvatar}>
            {identityAvatarImage ? <img src={String(identityAvatarImage)} alt={displayName} /> : <span>{initials(displayName) || "C"}</span>}
          </div>
          <div>
            <strong>{displayName}</strong>
            <p>{username}</p>
          </div>
          <p className={styles.identityLine}>Vida de flows. Del Sur para el mundo.</p>
        </section>

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

        <button type="button" className={styles.aiStatus} onClick={() => openAssistant()}>
          <span className={styles.aiMascot}><Image src="/assets/clouva-ai/trebol-mascot.png" alt="" width={36} height={36} /></span>
          <div>
            <b>CLOUVA AI</b>
            <small>Lista para ayudarte</small>
          </div>
          <i />
        </button>
      </aside>

      <section className={styles.content}>
        <section
          className={styles.hero}
          data-visual-asset="player-public-profile-cover-01"
          style={{ backgroundImage: `url(${heroPlayerImage})` }}
        >
          <div className={styles.heroShade} aria-hidden="true" />
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>{isSignedIn ? "Bienvenido de nuevo" : "Bienvenido a tu universo"}</span>
            <h1>{displayName}</h1>
            <p>Tu casa dentro de CLOUVA.<br />Creá, administrá y explorá desde acá.</p>
            <div className={styles.heroActions}>
              <Link href={playerHref}>
                <CircleUserRound size={17} />
                Mi Player
              </Link>
              <Link href={CLOUVA_NAVIGATION.MATRIX.href} className={styles.secondaryAction}>
                <Compass size={17} />
                Explorar La Matrix
              </Link>
            </div>
          </div>

          <button
            type="button"
            className={styles.heroAICompanion}
            onClick={() => openAssistant()}
            aria-label="Abrir CLOUVA AI"
          >
            <span className={styles.heroAISpeech}>¿Qué hacemos hoy, {displayName}?</span>
            <span className={styles.heroAIGlow} aria-hidden="true" />
            <span className={styles.heroAIMascot}>
              <Image src="/assets/clouva-ai/trebol-mascot.png" alt="" width={150} height={150} />
            </span>
          </button>

          <div className={styles.nowPlaying}>
            <div className={styles.cover}>
              {playback?.track.coverUrl ? (
                <img src={playback.track.coverUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} />
              ) : (
                <Music2 size={20} />
              )}
            </div>
            <SpotifyHomeStatus />
            <Link href="/mi-flow/music" aria-label="Abrir música"><ArrowRight size={17} /></Link>
          </div>
        </section>

        <section className={styles.moduleGrid} aria-label="Puertas principales de CLOUVA">
          {effectiveModules.map((module) => {
            const Icon = module.icon;
            return (
              <Link key={module.key} href={module.href} className={styles.moduleCard}>
                <span className={styles.moduleIcon}><Icon size={21} /></span>
                <div>
                  <h2>{module.title}</h2>
                  <p>{module.description}</p>
                  <span>{module.cta} <ArrowRight size={13} /></span>
                </div>
              </Link>
            );
          })}
        </section>
      </section>

      <aside className={styles.rail}>
        <section className={styles.railCard}>
          <div className={styles.railHeading}>
            <h2>Tu identidad</h2>
            <Link href="/perfil">Ver perfil privado</Link>
          </div>
          <div className={styles.checkList}>
            <div>
              <span className={isSignedIn ? styles.done : undefined}><CircleUserRound size={16} /></span>
              <p><b>Cuenta CLOUVA</b><small>{isSignedIn ? "Conectada" : "Iniciá sesión para guardar tu mundo"}</small></p>
            </div>
            <div>
              <span className={currentPlayer ? styles.done : undefined}><UsersRound size={16} /></span>
              <p><b>Player público</b><small>{currentPlayer ? username : "Creá tu identidad dentro de La Matrix"}</small></p>
            </div>
            <div>
              <span className={hasAvatar ? styles.done : undefined}><Box size={16} /></span>
              <p><b>Avatar 3D</b><small>{hasAvatar ? "Listo para personalizar" : "Creá o elegí tu personaje"}</small></p>
            </div>
          </div>
        </section>

        <section className={styles.railCard}>
          <div className={styles.railHeading}>
            <h2>Progreso creativo</h2>
            <span>{progress}%</span>
          </div>
          <div className={styles.progress}><span style={{ width: `${progress}%` }} /></div>
          <p className={styles.progressCopy}>{completedSteps} de 3 pasos principales completos</p>
          <div className={styles.progressStats}>
            <div><CircleUserRound size={17} /><b>{currentPlayer ? "Activo" : "Pendiente"}</b><small>Player</small></div>
            <div><Box size={17} /><b>{hasAvatar ? "Listo" : "Pendiente"}</b><small>Avatar</small></div>
          </div>
        </section>

        <Link href={CLOUVA_NAVIGATION.MATRIX.href} className={styles.matrixTeaser}>
          <span>LA MATRIX</span>
          <h2>Tu red creativa empieza acá.</h2>
          <p>Descubrí Players, Estudios y proyectos conectados.</p>
          <b>Explorar ahora <ArrowRight size={14} /></b>
        </Link>

        <Link href={CLOUVA_NAVIGATION.MARKET.href} className={styles.quickLink}>
          <Store size={19} />
          <span><b>Últimos drops</b><small>Explorá CLOUVA Market</small></span>
          <ArrowRight size={15} />
        </Link>
      </aside>

      <nav className={styles.mobileNav} aria-label="Navegación móvil">
        {primaryNav.map((item) => {
          const Icon = item.icon;
          return <Link key={item.href} href={item.href} className={item.key === "HOME" ? styles.mobileActive : undefined}><Icon size={18} /><span>{item.label}</span></Link>;
        })}
      </nav>
    </main>
  );
}
