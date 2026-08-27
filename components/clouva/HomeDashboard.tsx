"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Bell,
  Box,
  CircleUserRound,
  Compass,
  Headphones,
  Home,
  LayoutGrid,
  Menu,
  Music2,
  Palette,
  Search,
  ShoppingBag,
  Sparkles,
  Store,
  UsersRound,
  WandSparkles,
} from "lucide-react";
import { CloverIcon } from "@/components/clover-icon";
import { useAuth } from "@/components/auth-provider";
import { useCurrentPlayer } from "@/components/current-player-provider";
import { AccountMenu } from "@/components/account/AccountMenu";
import { useClouvaAIAssistant } from "@/components/clouva-ai/ClouvaAIAssistantProvider";
import { SpotifyHomeStatus } from "@/components/music/SpotifyHomeStatus";
import { useSpotifyPlayback } from "@/components/music/SpotifyPlaybackProvider";
import { resolveHomeDisplayName } from "@/lib/identity-names";
import { VISUAL_ASSETS } from "@/lib/visual-assets";
import styles from "./home-dashboard.module.css";

const primaryNav = [
  { label: "Inicio", href: "/", icon: Home, available: true },
  { label: "Crear", href: "/crear", icon: Sparkles, available: false, adminOnly: true },
  { label: "Mi Avatar", href: "/mi-flow/avatar", icon: CircleUserRound, available: false },
  { label: "Música", href: "/mi-flow/music", icon: Music2, available: true },
  { label: "Tienda", href: "/tienda", icon: ShoppingBag, available: true },
  { label: "La Matrix", href: "/matrix", icon: LayoutGrid, available: true },
  { label: "Creator Studio", href: "/creator-studio", icon: WandSparkles, available: false },
];

const modules = [
  {
    title: "Personalizá tu Avatar",
    description: "Creá una identidad digital que se sienta realmente tuya.",
    href: "/mi-flow/avatar",
    cta: "Ir al Avatar",
    icon: CircleUserRound,
    available: false,
  },
  {
    title: "Escuchá tu música",
    description: "Tu universo musical, siempre conectado a tu perfil.",
    href: "/mi-flow/music",
    cta: "Ir a Música",
    icon: Headphones,
    available: true,
  },
  {
    title: "Descubrí la tienda",
    description: "Merch, ediciones limitadas y drops de la comunidad.",
    href: "/tienda",
    cta: "Ir a Tienda",
    icon: ShoppingBag,
    available: true,
  },
  {
    title: "Explorá La Matrix",
    description: "Players, Estudios y proyectos que crean en comunidad.",
    href: "/matrix",
    cta: "Explorar",
    icon: Compass,
    available: true,
  },
  {
    title: "Entrá al Creator Studio",
    description: "Prepará avatares, prendas y recursos para tu mundo.",
    href: "/creator-studio",
    cta: "Abrir Studio",
    icon: Palette,
    available: false,
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
  const { user, profile, role } = useAuth();
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
  const isAdmin = role === "admin";
  const effectivePrimaryNav = primaryNav
    .filter((item) => !("adminOnly" in item) || !item.adminOnly || isAdmin)
    .map((item) => ({ ...item, available: item.available || isAdmin }));
  const effectiveModules = modules.map((item) => ({ ...item, available: item.available || isAdmin }));

  return (
    <main className={styles.page}>
      <div className={styles.ambient} aria-hidden="true" />

      <header className={styles.topbar}>
        <Link href="/" className={styles.wordmark}>
          <span className={styles.brandIcon}><CloverIcon size={23} /></span>
          <span>CLOUVA</span>
        </Link>

        <nav className={styles.topnav} aria-label="Navegación principal">
          {effectivePrimaryNav.slice(0, 5).map((item) => item.available ? (
            <Link key={item.href} href={item.href} className={item.href === "/" ? styles.topnavActive : undefined}>{item.label}</Link>
          ) : (
            <span key={item.href} className={styles.comingNav} title="Próximamente">{item.label}<small>Próximamente</small></span>
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

        <nav className={styles.sideNav} aria-label="Secciones de CLOUVA">
          {effectivePrimaryNav.map((item) => {
            const Icon = item.icon;
            return item.available ? (
              <Link key={item.href} href={item.href} className={item.href === "/" ? styles.sideNavActive : undefined}>
                <Icon size={17} />
                <span>{item.label}</span>
              </Link>
            ) : (
              <span key={item.href} className={styles.disabledNav}>
                <Icon size={17} />
                <span>{item.label}</span>
                <small>Próximamente</small>
              </span>
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
            <p>Crea. Personaliza. Conecta.<br />Viví tu propio mundo.</p>
            <div className={styles.heroActions}>
              {isAdmin ? (
                <Link href="/mi-flow/avatar">
                  <CircleUserRound size={17} />
                  Avatar
                </Link>
              ) : (
                <span className={styles.disabledHeroAction} aria-disabled="true">
                  <CircleUserRound size={17} />
                  Avatar · Próximamente
                </span>
              )}
              <Link href="/matrix" className={styles.secondaryAction}>
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

        <section className={styles.moduleGrid} aria-label="Explorar CLOUVA">
          {effectiveModules.map((module) => {
            const Icon = module.icon;
            const cardContent = (
              <>
                <span className={styles.moduleIcon}><Icon size={21} /></span>
                <div>
                  <h2>{module.title}</h2>
                  <p>{module.description}</p>
                  <span>{module.available ? module.cta : "Próximamente"} {module.available ? <ArrowRight size={13} /> : null}</span>
                </div>
              </>
            );
            return module.available ? (
              <Link key={module.title} href={module.href} className={styles.moduleCard}>
                {cardContent}
              </Link>
            ) : (
              <article key={module.title} className={`${styles.moduleCard} ${styles.moduleComing}`} aria-disabled="true">
                {cardContent}
              </article>
            );
          })}
        </section>
      </section>

      <aside className={styles.rail}>
        <section className={styles.railCard}>
          <div className={styles.railHeading}>
            <h2>Tu identidad</h2>
            <Link href="/perfil">Ver perfil</Link>
          </div>
          <div className={styles.checkList}>
            <div>
              <span className={isSignedIn ? styles.done : undefined}><CircleUserRound size={16} /></span>
              <p><b>Cuenta CLOUVA</b><small>{isSignedIn ? "Conectada" : "Iniciá sesión para guardar tu mundo"}</small></p>
            </div>
            <div>
              <span className={profile?.username ? styles.done : undefined}><UsersRound size={16} /></span>
              <p><b>Perfil público</b><small>{profile?.username ? username : "Elegí tu nombre dentro de La Matrix"}</small></p>
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
            <div><CircleUserRound size={17} /><b>{profile?.username ? "Activo" : "Pendiente"}</b><small>Perfil</small></div>
            <div><Box size={17} /><b>{hasAvatar ? "Listo" : "Pendiente"}</b><small>Avatar</small></div>
          </div>
        </section>

        <Link href="/matrix" className={styles.matrixTeaser}>
          <span>LA MATRIX</span>
          <h2>Tu red creativa empieza acá.</h2>
          <p>Descubrí Players, Estudios y proyectos conectados.</p>
          <b>Explorar ahora <ArrowRight size={14} /></b>
        </Link>

        <Link href="/tienda" className={styles.quickLink}>
          <Store size={19} />
          <span><b>Últimos drops</b><small>Explorá la tienda CLOUVA</small></span>
          <ArrowRight size={15} />
        </Link>
      </aside>

      <nav className={styles.mobileNav} aria-label="Navegación móvil">
        {effectivePrimaryNav.slice(0, 5).map((item) => {
          const Icon = item.icon;
          return item.available
            ? <Link key={item.href} href={item.href} className={item.href === "/" ? styles.mobileActive : undefined}><Icon size={18} /><span>{item.label}</span></Link>
            : <span key={item.href} className={styles.mobileDisabled}><Icon size={18} /><span>{item.label}</span></span>;
        })}
      </nav>
    </main>
  );
}
