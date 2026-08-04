import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Calendar, Headphones, Heart, Mic, Music, Play, Sparkles, Star, Users as UsersIcon } from "lucide-react";
import { PublicMediaGallery } from "./PublicMediaGallery";
import { PublicShareButton } from "./PublicShareButton";
import { PublicSocialLinks } from "./PublicSocialLinks";
import { StudioServicesCart } from "./StudioServicesCart";
import { StudioManageButton } from "./StudioManageButton";
import { formatPlanPrice, studioSocialLinks } from "./StudioPublicView";
import { parseMusicEmbed } from "@/lib/music-embed";
import type { HeroSection, LayoutConfig, LayoutIconName, LayoutSection, LayoutSectionType, RadiusValue } from "@/lib/server/layout-config";
import type { PlayerMedia, SocialLink, StudioMembershipPlan, StudioPlayer, StudioRow, StudioService } from "@/lib/players-data";

// Catálogo cerrado de íconos del hero y los pillars (ver LAYOUT_ICONS en
// layout-config.ts) -- solo estos 10, nunca uno arbitrario que Gemini haya
// propuesto.
export const LAYOUT_ICON_MAP: Record<LayoutIconName, typeof Sparkles> = {
  sparkles: Sparkles,
  play: Play,
  users: UsersIcon,
  music: Music,
  heart: Heart,
  "arrow-right": ArrowRight,
  mic: Mic,
  calendar: Calendar,
  headphones: Headphones,
  star: Star,
};

type CustomNavLink = { label: string; href: string };

// Contraparte de PublicShell, deliberadamente sin AccountMenu/
// NotificationBell/buscador/"Explorar La Matrix" -- cuando un Estudio tiene
// un diseño propio (mockup fiel o variante elegida), el header tiene que
// poder verse tal cual esa referencia, no con el chrome fijo de CLOUVA
// encima. El logo/nombre siguen enlazando a /matrix como única salida hacia
// el resto de la plataforma (decisión confirmada con el usuario: prioridad
// a la fidelidad visual sobre mantener ese acceso siempre a la vista).
export function CustomShell({
  brand,
  logoUrl,
  navLinks,
  navStyle,
  accent,
  joinAction,
  links,
  footer,
  headerOverlay = false,
  children,
}: {
  brand: string;
  logoUrl?: string | null;
  navLinks: CustomNavLink[];
  navStyle: "pill" | "bar";
  accent: string;
  joinAction: { label: string; href: string };
  links: SocialLink[];
  footer?: ReactNode;
  // Solo lo usa layout_kind "precise" cuando el mockup muestra el nav
  // integrado sobre la imagen del hero en vez de una barra sólida aparte --
  // el modo "template" nunca lo pasa, así que su header queda exactamente
  // igual que siempre.
  headerOverlay?: boolean;
  children: ReactNode;
}) {
  const initial = brand.trim().charAt(0).toUpperCase() || "C";
  return (
    <div className="relative min-h-screen bg-[#07060b] text-white" style={{ ["--public-accent" as string]: accent }}>
      <header
        className={
          headerOverlay
            ? "absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/60 via-black/20 to-transparent"
            : "sticky top-0 z-20 border-b border-white/10 bg-[#07060b]/90 backdrop-blur-xl"
        }
      >
        <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-5 px-4 py-3 sm:px-6">
          <Link href="/matrix" className="flex shrink-0 items-center gap-2 text-base font-semibold tracking-wide">
            {logoUrl ? (
              <img src={logoUrl} alt={brand} className="h-8 w-8 rounded-lg object-cover" />
            ) : (
              <span className="grid h-8 w-8 place-items-center rounded-xl border border-[color:var(--public-accent)]/40 bg-[color:var(--public-accent)]/10 text-xs font-bold text-[color:var(--public-accent)]">{initial}</span>
            )}
            <span>{brand}</span>
          </Link>
          {navLinks.length && navStyle === "pill" ? (
            <nav className="mx-auto hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.025] p-1 text-xs text-white/65 md:flex">
              {navLinks.map((link) => (
                <Link key={link.href} href={link.href} className="rounded-full px-4 py-2 transition hover:bg-[color:var(--public-accent)]/10 hover:text-white">{link.label}</Link>
              ))}
            </nav>
          ) : null}
          {/* CTA de unirse siempre visible en el header, sin necesidad de
              scrollear hasta el hero -- gap real encontrado comparando contra
              el mockup de referencia (tenía un botón "INGLÚATE" fijo arriba). */}
          <Link href={joinAction.href} className="ml-auto shrink-0 rounded-full bg-[color:var(--public-accent)] px-4 py-2 text-xs font-semibold transition hover:opacity-90">
            {joinAction.label}
          </Link>
        </div>
        {navLinks.length && navStyle === "bar" ? (
          <nav className="hidden justify-center gap-8 border-t border-white/[0.06] bg-black/40 px-4 py-3 text-xs font-medium uppercase tracking-[0.18em] text-white/60 md:flex">
            {navLinks.map((link) => <Link key={link.href} href={link.href} className="transition hover:text-[color:var(--public-accent)]">{link.label}</Link>)}
          </nav>
        ) : null}
        {navLinks.length ? (
          <nav className="flex gap-1 overflow-x-auto border-t border-white/[0.06] px-3 py-2 text-[11px] text-white/60 md:hidden">
            {navLinks.map((link) => <Link key={link.href} href={link.href} className="shrink-0 rounded-full px-3 py-1.5 hover:bg-white/5 hover:text-white">{link.label}</Link>)}
          </nav>
        ) : null}
      </header>
      <main>{children}</main>
      <footer className="border-t border-white/10 px-4 py-8 text-center text-xs text-white/40 sm:px-6">
        {links.length ? (
          <div className="mb-5 flex justify-center">
            <PublicSocialLinks links={links} />
          </div>
        ) : null}
        {footer ?? `${brand} · CLOUVA`}
      </footer>
    </div>
  );
}

export const SECTION_ANCHOR: Record<LayoutSectionType, string> = {
  hero: "inicio",
  about: "sobre",
  pillars: "pilares",
  gallery: "galeria",
  roster: "players",
  services: "servicios",
  membership: "membresias",
  music: "musica",
  contact: "contacto",
};

export const SECTION_NAV_LABEL: Record<LayoutSectionType, string> = {
  hero: "Inicio",
  about: "Sobre",
  pillars: "Pilares",
  gallery: "Galería",
  roster: "Players",
  services: "Servicios",
  membership: "Membresías",
  music: "Música",
  contact: "Contacto",
};

export const RADIUS_CLASS: Record<RadiusValue, string> = {
  none: "rounded-none",
  small: "rounded-lg",
  medium: "rounded-2xl",
  large: "rounded-[2.5rem]",
};

// Compartida entre StudioLayoutRenderer (esquema viejo sections/variant) y
// PreciseStudioLayoutRenderer (esquema nuevo precise_sections) -- la lógica
// de prioridad (canal propio > lanzamientos propios > descubrimiento de La
// Matrix > estado vacío) es real lógica de negocio, no solo markup, así que
// vive en un solo lugar en vez de duplicarse entre los dos renderers.
export function renderMusicSection({
  sectionKey,
  heading: headingOverride,
  isList,
  maxReleases,
  musicLinks,
  projects,
  matrixDiscoveryProjects,
  studioName,
  radiusClass,
}: {
  sectionKey: string | number;
  heading?: string | null;
  isList: boolean;
  maxReleases: number;
  musicLinks: SocialLink[];
  projects: Array<Record<string, unknown>>;
  matrixDiscoveryProjects: Array<Record<string, unknown>>;
  studioName: string;
  radiusClass: string;
}): ReactNode {
  const channelEmbed = musicLinks.map((link) => parseMusicEmbed(link.url)).find((embed): embed is NonNullable<typeof embed> => embed !== null) ?? null;
  const isDiscovery = projects.length === 0 && matrixDiscoveryProjects.length > 0;
  const sourceProjects = projects.length ? projects : matrixDiscoveryProjects;
  const releases = sourceProjects.slice(0, maxReleases);
  const heading = headingOverride || (isDiscovery ? "Descubrí en La Matrix" : "Música y lanzamientos");

  if (!channelEmbed && releases.length === 0) {
    return (
      <section key={sectionKey} id={SECTION_ANCHOR.music} className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <p className="text-xs uppercase tracking-[0.24em] text-[color:var(--public-accent)]/80">{heading}</p>
        <p className={`mt-5 border border-white/10 bg-white/[0.025] p-6 text-sm text-white/50 ${radiusClass}`}>Todavía no hay música cargada.</p>
      </section>
    );
  }

  return (
    <section key={sectionKey} id={SECTION_ANCHOR.music} className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <p className="text-xs uppercase tracking-[0.24em] text-[color:var(--public-accent)]/80">{heading}</p>
      {channelEmbed ? (
        <div className={`mt-5 overflow-hidden border border-white/10 ${radiusClass}`}>
          <iframe
            title={`${studioName} en ${channelEmbed.platform === "spotify" ? "Spotify" : "YouTube"}`}
            src={channelEmbed.src}
            width="100%"
            height={channelEmbed.platform === "spotify" ? 352 : 315}
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            className="block border-0"
          />
        </div>
      ) : null}
      {releases.length ? (
        <div className={isList ? "mt-5 space-y-3" : "mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"}>
          {releases.map((project) => {
            const embed = parseMusicEmbed(project.spotify_url ? String(project.spotify_url) : null) ?? parseMusicEmbed(project.youtube_url ? String(project.youtube_url) : null);
            const originStudio = project.studio && typeof project.studio === "object" ? String((project.studio as Record<string, unknown>).name ?? "") : "";
            return (
              <article key={String(project.id)} className={`overflow-hidden border border-white/10 bg-white/[0.025] ${radiusClass} ${isList && !embed ? "flex items-center gap-4 p-3" : ""}`}>
                {embed ? (
                  <iframe
                    title={String(project.title || "Lanzamiento")}
                    src={embed.src}
                    width="100%"
                    height={embed.platform === "spotify" ? 152 : 200}
                    allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                    loading="lazy"
                    className="block border-0"
                  />
                ) : project.cover_url ? (
                  <img src={String(project.cover_url)} alt="" className={isList ? "h-14 w-14 shrink-0 rounded-lg object-cover" : "aspect-square w-full object-cover"} />
                ) : null}
                <div className={isList && !embed ? "min-w-0" : "p-4"}>
                  <p className="truncate font-semibold">{String(project.title || "Lanzamiento")}</p>
                  {originStudio ? <p className="truncate text-xs text-white/40">{originStudio}</p> : null}
                  {!embed ? (
                    <div className="mt-1 flex gap-3 text-xs text-[color:var(--public-accent)]">
                      {project.spotify_url ? <a href={String(project.spotify_url)} target="_blank" rel="noreferrer">Spotify</a> : null}
                      {project.youtube_url ? <a href={String(project.youtube_url)} target="_blank" rel="noreferrer">YouTube</a> : null}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

// Contraparte de StudioPublicView.tsx cuando el Estudio tiene un
// layout_config real (mockup replicado o variante elegida): mismo shell
// base, mismos datos reales (players/servicios/planes/galería/lanzamientos),
// pero el orden, inclusión, estilo y composición de cada sección vienen del
// layout en vez de estar hardcodeados. Nunca renderiza HTML/markup que venga
// de layout_config -- solo texto plano (React escapa) y, para el hero, la
// combinación de un vocabulario fijo de variantes con las imágenes reales
// del Estudio (cover_url/logo_url), nunca una URL que la IA haya inventado.
export function StudioLayoutRenderer({
  studio,
  players,
  media,
  projects,
  matrixDiscoveryProjects = [],
  services,
  membershipPlans = [],
  joined = false,
  layout,
}: {
  studio: StudioRow;
  players: StudioPlayer[];
  media: PlayerMedia[];
  projects: Array<Record<string, unknown>>;
  matrixDiscoveryProjects?: Array<Record<string, unknown>>;
  services: StudioService[];
  membershipPlans?: StudioMembershipPlan[];
  joined?: boolean;
  layout: LayoutConfig;
}) {
  const links = studioSocialLinks(studio);
  // Canal propio de Spotify/YouTube del Estudio (no un lanzamiento suelto) --
  // si existe, el reproductor de la sección "música" lo muestra como pieza
  // destacada antes que la grilla de lanzamientos individuales.
  const musicLinks = links.filter((link) => link.platform === "spotify" || link.platform === "youtube");
  const defaultMembershipPlan = membershipPlans.find((plan) => plan.is_free) ?? membershipPlans[0] ?? null;
  const joinHref = defaultMembershipPlan
    ? `/studios/${studio.slug}/checkout${defaultMembershipPlan.is_free ? "" : `?plan=${defaultMembershipPlan.slug}`}`
    : `/studios/${studio.slug}/join`;
  // Si el Estudio tiene Players reales, la sección roster siempre entra --
  // no queda a discreción de Gemini, para que "ver Players" nunca sea un
  // link muerto cuando hay gente real para mostrar.
  const sections: LayoutSection[] = players.length && !layout.sections.some((s) => s.type === "roster")
    ? [...layout.sections, { type: "roster", variant: "cards", heading: null }]
    : layout.sections;
  const includedTypes = new Set(sections.map((section) => section.type));
  // CTA de unirse del header -- siempre la lógica real de membresía, nunca un
  // label propuesto por Gemini (a diferencia de los botones del hero, este
  // vive fuera de cualquier sección y tiene que funcionar solo).
  const headerJoinAction = { label: joined ? "Ya sos miembro" : "Unirme", href: joined && includedTypes.has("roster") ? `#${SECTION_ANCHOR.roster}` : joinHref };
  const radiusClass = RADIUS_CLASS[layout.page_style?.radius ?? "medium"];
  const location = [studio.city, studio.country].filter(Boolean).join(", ");

  const navLinks: CustomNavLink[] = layout.nav_items?.length
    ? layout.nav_items.map((item) => ({ label: item.label, href: `#${SECTION_ANCHOR[item.section]}` }))
    : sections
        .filter((section) => section.type !== "hero")
        .map((section) => ({ label: SECTION_NAV_LABEL[section.type], href: `#${SECTION_ANCHOR[section.type]}` }));
  if (players.length && includedTypes.has("roster") && !navLinks.some((link) => link.href === `#${SECTION_ANCHOR.roster}`)) {
    navLinks.push({ label: "Players", href: `#${SECTION_ANCHOR.roster}` });
  }

  const footer = layout.footer && includedTypes.has(layout.footer.cta_section) ? (
    <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 sm:flex-row sm:justify-between">
      <p className="text-sm text-white/60">{layout.footer.heading}</p>
      <Link href={`#${SECTION_ANCHOR[layout.footer.cta_section]}`} className="rounded-xl bg-[color:var(--public-accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90">
        {layout.footer.cta_label}
      </Link>
    </div>
  ) : undefined;

  function renderHero(section: HeroSection, index: number) {
    const badges = studio.categories || [];
    const initial = studio.name.trim().charAt(0).toUpperCase() || "C";
    // Wordmark tipográfico CSS -- Gemini tiene prohibido renderizar texto en
    // imágenes (lo hace mal), así que el nombre real del Estudio siempre va
    // en texto HTML real y grande, con el ícono abstracto de Gemini (si hay)
    // como acompañante chico al lado, nunca reemplazándolo.
    const wordmark = (
      <div className="flex items-center gap-3">
        {studio.logo_url ? <img src={studio.logo_url} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" /> : null}
        <span className="text-2xl font-black uppercase tracking-[0.08em] text-white sm:text-3xl">{studio.name}</span>
      </div>
    );
    // primaryLabel/secondaryLabel (si Gemini los propuso) reemplazan el texto
    // del botón -- el destino (href) sigue siendo siempre el real, calculado
    // acá, nunca algo que la IA pueda inventar.
    const primaryAction = { label: section.primaryLabel || (joined ? "Ya sos miembro" : "Quiero unirme"), href: joined && includedTypes.has("roster") ? `#${SECTION_ANCHOR.roster}` : joinHref };
    // Mismo comportamiento de siempre cuando no hay secondaryLabel propio: el
    // botón solo existe si hay roster real. Si Gemini SÍ propuso un label
    // propio pero no hay roster, cae a la primera otra sección real en vez de
    // desaparecer -- nunca un link muerto, nunca un botón fabricado de la nada
    // cuando antes no había ninguno.
    const rosterAvailable = players.length > 0 && includedTypes.has("roster");
    const secondaryTargetType: LayoutSectionType | null = rosterAvailable
      ? "roster"
      : section.secondaryLabel
        ? sections.find((s) => s.type !== "hero")?.type ?? null
        : null;
    const secondaryAction = secondaryTargetType
      ? { label: section.secondaryLabel || "Conocer Players", href: `#${SECTION_ANCHOR[secondaryTargetType]}` }
      : null;
    const PrimaryIcon = section.primaryIcon ? LAYOUT_ICON_MAP[section.primaryIcon] : null;
    const SecondaryIcon = section.secondaryIcon ? LAYOUT_ICON_MAP[section.secondaryIcon] : null;
    const actions = (
      <div className="flex flex-wrap gap-2">
        <Link href={primaryAction.href} className="inline-flex items-center gap-2 rounded-full bg-[color:var(--public-accent)] px-5 py-2.5 text-sm font-semibold transition hover:opacity-90">
          {PrimaryIcon ? <PrimaryIcon className="h-4 w-4" /> : null}
          {primaryAction.label}
        </Link>
        {secondaryAction ? (
          <Link href={secondaryAction.href} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-5 py-2.5 text-sm font-semibold transition hover:border-[color:var(--public-accent)]/60">
            {SecondaryIcon ? <SecondaryIcon className="h-4 w-4" /> : null}
            {secondaryAction.label}
          </Link>
        ) : null}
        <PublicShareButton title={studio.name} />
      </div>
    );
    const badgeRow = badges.length ? (
      <div className="flex flex-wrap gap-2">
        {badges.map((badge) => <span key={badge} className="rounded-full border border-[color:var(--public-accent)]/30 bg-[color:var(--public-accent)]/10 px-3 py-1 text-xs text-[color:var(--public-accent)]">{badge}</span>)}
      </div>
    ) : null;

    switch (section.variant) {
      // Imagen a un costado, texto al otro -- composición en columnas, no un
      // fondo a pantalla completa. La más distinta de la plantilla estándar.
      case "split":
        return (
          <section key={index} id={SECTION_ANCHOR.hero} className="border-b border-white/10">
            <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:items-center">
              <div className="order-2 lg:order-1">
                {wordmark}
                <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.28em] text-[color:var(--public-accent)]/80">Estudio</p>
                <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">{section.headline}</h1>
                {section.subheadline ? <p className="mt-4 text-lg leading-relaxed text-white/70">{section.subheadline}</p> : null}
                {location ? <p className="mt-2 text-sm text-white/45">{location}</p> : null}
                <div className="mt-6">{badgeRow}</div>
                <div className="mt-6">{actions}</div>
              </div>
              <div className={`order-1 h-64 overflow-hidden border border-white/10 bg-white/[0.03] sm:h-96 lg:order-2 ${radiusClass}`}>
                {studio.cover_url ? <img src={studio.cover_url} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center text-6xl font-semibold text-white/20">{initial}</div>}
              </div>
            </div>
          </section>
        );

      // Editorial: portada chica tipo inset, título estilo tapa de revista,
      // sin imagen de fondo dominando la sección.
      case "editorial":
        return (
          <section key={index} id={SECTION_ANCHOR.hero} className="border-b border-white/10">
            <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6">
              <p className="text-xs font-semibold uppercase tracking-[0.4em] text-[color:var(--public-accent)]/80">Estudio</p>
              <h1 className="mt-4 text-5xl font-black leading-[0.95] tracking-tight sm:text-7xl">{section.headline}</h1>
              {section.subheadline ? <p className="mx-auto mt-5 max-w-xl text-lg text-white/65">{section.subheadline}</p> : null}
              <div className="mt-7 flex justify-center">{actions}</div>
              {studio.cover_url ? (
                <div className={`mx-auto mt-10 aspect-[21/9] max-w-3xl overflow-hidden border border-white/10 ${radiusClass}`}>
                  <img src={studio.cover_url} alt="" className="h-full w-full object-cover" />
                </div>
              ) : null}
            </div>
          </section>
        );

      // Full-bleed edge-to-edge, sin bordes redondeados ni contenedor -- la
      // imagen ocupa todo el ancho de la pantalla, título gigante abajo.
      case "full-bleed":
        return (
          <section key={index} id={SECTION_ANCHOR.hero} className="relative flex min-h-[70vh] items-end overflow-hidden border-b border-white/10">
            {studio.cover_url ? <img src={studio.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 bg-gradient-to-br from-[color:var(--public-accent)]/25 to-black" />}
            <div className="absolute inset-0 bg-gradient-to-t from-[#07060b] via-[#07060b]/40 to-transparent" />
            <div className="relative w-full px-4 pb-12 sm:px-6">
              <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-6">
                <div>
                  {badgeRow}
                  <h1 className="mt-4 text-5xl font-bold tracking-tight sm:text-7xl">{section.headline}</h1>
                  {section.subheadline ? <p className="mt-3 max-w-xl text-lg text-white/75">{section.subheadline}</p> : null}
                </div>
                {actions}
              </div>
            </div>
          </section>
        );

      // Overlay cinematográfico: logo insignia superpuesto, título centrado
      // con tracking amplio, CTA flotando sobre la imagen.
      case "overlay":
        return (
          <section key={index} id={SECTION_ANCHOR.hero} className="relative flex min-h-[75vh] flex-col items-center justify-center overflow-hidden border-b border-white/10 text-center">
            {studio.cover_url ? <img src={studio.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 bg-gradient-to-br from-[color:var(--public-accent)]/25 to-black" />}
            <div className="absolute inset-0 bg-black/55" />
            <div className="relative flex flex-col items-center px-4">
              {wordmark}
              <h1 className="mt-6 text-4xl font-semibold uppercase tracking-[0.15em] sm:text-6xl">{section.headline}</h1>
              {section.subheadline ? <p className="mt-4 max-w-lg text-white/80">{section.subheadline}</p> : null}
              <div className="mt-8">{actions}</div>
            </div>
          </section>
        );

      // "centered" (default): imagen de fondo con contenido centrado, más
      // compacto que overlay/full-bleed -- la variante "segura" por defecto.
      case "centered":
      default:
        return (
          <section key={index} id={SECTION_ANCHOR.hero} className="relative overflow-hidden border-b border-white/10">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(124,58,237,.28),transparent_45%),linear-gradient(180deg,#0d0a18_0%,#07060b_100%)]" />
            <div className="relative mx-auto max-w-4xl px-4 py-16 text-center sm:px-6">
              <div className={`relative mx-auto h-48 overflow-hidden border border-white/10 bg-white/[0.03] sm:h-64 ${radiusClass}`}>
                {studio.cover_url ? <img src={studio.cover_url} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center text-6xl font-semibold text-white/20">{initial}</div>}
                <div className="absolute inset-0 bg-gradient-to-t from-[#07060b] via-transparent to-transparent" />
              </div>
              <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-6xl">{section.headline}</h1>
              {section.subheadline ? <p className="mx-auto mt-3 max-w-xl text-lg text-white/70">{section.subheadline}</p> : null}
              <div className="mt-3">{location ? <p className="text-sm text-white/45">{location}</p> : null}</div>
              <div className="mt-6 flex justify-center">{badgeRow}</div>
              <div className="mt-6 flex justify-center">{actions}</div>
            </div>
          </section>
        );
    }
  }

  function renderSection(section: LayoutSection, index: number) {
    switch (section.type) {
      case "hero":
        return (
          <div key={index}>
            {renderHero(section, index)}
            {joined ? (
              <div className="mx-auto -mt-2 max-w-6xl px-4 pt-6 sm:px-6">
                <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-5 py-4 text-sm text-emerald-100 shadow-[0_20px_60px_rgba(16,185,129,.08)]">
                  Ya sos miembro de {studio.name}. Tu Player quedó vinculado con el rol del plan elegido.
                </div>
              </div>
            ) : null}
            <div className="mx-auto mt-4 max-w-6xl px-4 sm:px-6">
              <StudioManageButton studioId={studio.id} />
            </div>
          </div>
        );

      case "about": {
        const showAside = section.variant !== "simple" && links.length > 0;
        return (
          <section key={index} id={SECTION_ANCHOR.about} className={`mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6 ${showAside ? "lg:grid-cols-[minmax(0,1fr)_320px]" : ""}`}>
            <article className={`border border-white/10 bg-white/[0.025] p-6 sm:p-8 ${radiusClass} ${showAside ? "" : "mx-auto max-w-3xl text-center"}`}>
              <p className="text-xs uppercase tracking-[0.24em] text-[color:var(--public-accent)]/80">{section.heading}</p>
              <h2 className="mt-2 text-2xl font-semibold">{studio.name}</h2>
              <p className="mt-5 whitespace-pre-line leading-8 text-white/70">{section.body}</p>
            </article>
            {showAside ? (
              <aside className={`border border-white/10 bg-white/[0.025] p-6 ${radiusClass}`}>
                <p className="mb-4 text-xs uppercase tracking-[0.24em] text-white/40">Links oficiales</p>
                <PublicSocialLinks links={links} />
              </aside>
            ) : null}
          </section>
        );
      }

      case "pillars": {
        if (section.variant === "icon-grid") {
          return (
            <section key={index} id={SECTION_ANCHOR.pillars} className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
              <p className="text-xs uppercase tracking-[0.24em] text-[color:var(--public-accent)]/80">Identidad</p>
              <h2 className="mt-1 text-2xl font-semibold">{section.heading}</h2>
              <div className="mt-6 divide-y divide-white/10 border-y border-white/10">
                {section.items.map((item, itemIndex) => (
                  <div key={itemIndex} className="flex items-start gap-5 py-5">
                    <span className="text-3xl font-black text-[color:var(--public-accent)]/70">{String(itemIndex + 1).padStart(2, "0")}</span>
                    <div>
                      <h3 className="font-semibold">{item.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-white/60">{item.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        }
        const columns = section.variant === "4-cards" ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3";
        return (
          <section key={index} id={SECTION_ANCHOR.pillars} className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <p className="text-xs uppercase tracking-[0.24em] text-[color:var(--public-accent)]/80">Identidad</p>
            <h2 className="mt-1 text-2xl font-semibold">{section.heading}</h2>
            <div className={`mt-5 grid gap-4 ${columns}`}>
              {section.items.map((item, itemIndex) => {
                const PillarIcon = item.icon ? LAYOUT_ICON_MAP[item.icon] : null;
                return item.image ? (
                  <article key={itemIndex} className={`relative min-h-56 overflow-hidden ${radiusClass}`}>
                    <img src={item.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
                    <div className="relative flex h-full min-h-56 flex-col justify-end p-6">
                      {PillarIcon ? <PillarIcon className="mb-2 h-5 w-5 text-[color:var(--public-accent)]" /> : null}
                      <h3 className="font-semibold">{item.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-white/75">{item.description}</p>
                    </div>
                  </article>
                ) : (
                  <article key={itemIndex} className={`border border-white/10 bg-white/[0.025] p-6 ${radiusClass}`}>
                    {PillarIcon ? <PillarIcon className="mb-2 h-5 w-5 text-[color:var(--public-accent)]" /> : null}
                    <h3 className="font-semibold">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-white/60">{item.description}</p>
                  </article>
                );
              })}
            </div>
          </section>
        );
      }

      case "gallery":
        return media.length ? (
          <div key={index} id={SECTION_ANCHOR.gallery}>
            <PublicMediaGallery media={media} />
          </div>
        ) : null;

      case "roster":
        return (
          <section key={index} id={SECTION_ANCHOR.roster} className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <p className="text-xs uppercase tracking-[0.24em] text-[color:var(--public-accent)]/80">Identidades</p>
            <h2 className="mt-1 text-2xl font-semibold">{section.heading || "Players"}</h2>
            {players.length === 0 ? (
              <div className={`mt-5 border border-dashed border-white/15 p-8 text-center text-white/45 ${radiusClass}`}>Próximos Players</div>
            ) : (
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {players.map((entry, playerIndex) => entry.player ? (
                  <Link key={`${entry.player.id}-${playerIndex}`} href={`/${entry.player.slug}`} className={`group flex items-center gap-4 border border-white/10 bg-white/[0.025] p-4 transition hover:border-[color:var(--public-accent)]/50 ${radiusClass}`}>
                    {entry.player.profile_image_url ? <img src={entry.player.profile_image_url} alt={entry.player.display_name} className={`h-16 w-16 object-cover ${radiusClass}`} /> : <div className={`flex h-16 w-16 items-center justify-center bg-[color:var(--public-accent)]/15 text-xl font-semibold ${radiusClass}`}>{entry.player.display_name.charAt(0)}</div>}
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{entry.player.display_name}</p>
                      <p className="mt-1 text-sm text-white/55">Player · {entry.role || "Miembro"}</p>
                    </div>
                  </Link>
                ) : null)}
              </div>
            )}
          </section>
        );

      case "membership":
        return membershipPlans.length ? (
          <section key={index} id={SECTION_ANCHOR.membership} className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <p className="text-xs uppercase tracking-[0.24em] text-[color:var(--public-accent)]/80">Formas de participar</p>
            <h2 className="mt-1 text-2xl font-semibold">{section.heading || "Membresías"}</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {membershipPlans.map((plan) => (
                <article key={plan.id} className={`flex flex-col border border-white/10 bg-white/[0.025] p-6 ${radiusClass}`}>
                  <h3 className="font-semibold">{plan.name}</h3>
                  {plan.description ? <p className="mt-3 line-clamp-3 text-sm leading-6 text-white/55">{plan.description}</p> : null}
                  <p className="mt-4 text-2xl font-bold">
                    {formatPlanPrice(plan)}
                    {!plan.is_free ? <span className="ml-1 text-sm font-normal text-white/45">/ {plan.billing_interval === "year" ? "año" : "mes"}</span> : null}
                  </p>
                  <Link href={`/studios/${studio.slug}/checkout${plan.is_free ? "" : `?plan=${plan.slug}`}`} className="mt-6 rounded-xl bg-[color:var(--public-accent)] px-5 py-3 text-center text-sm font-semibold transition hover:opacity-90">
                    {plan.join_policy === "approval" ? "Solicitar ingreso" : plan.is_free ? "Unirme gratis" : "Elegir plan"}
                  </Link>
                </article>
              ))}
            </div>
          </section>
        ) : null;

      case "services":
        return services.length ? (
          <section key={index} id={SECTION_ANCHOR.services} className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <p className="text-xs uppercase tracking-[0.24em] text-[color:var(--public-accent)]/80">Contratar</p>
            <h2 className="mt-1 text-2xl font-semibold">{section.heading || "Servicios"}</h2>
            <div className="mt-5"><StudioServicesCart studioId={studio.id} studioSlug={studio.slug} services={services} /></div>
          </section>
        ) : null;

      case "music":
        return renderMusicSection({
          sectionKey: index,
          heading: section.heading,
          isList: section.variant === "list",
          maxReleases: section.variant === "featured-release" ? 1 : 6,
          musicLinks,
          projects,
          matrixDiscoveryProjects,
          studioName: studio.name,
          radiusClass,
        });

      case "contact":
        return links.length ? (
          <section key={index} id={SECTION_ANCHOR.contact} className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <p className="text-xs uppercase tracking-[0.24em] text-[color:var(--public-accent)]/80">{section.heading || "Contacto"}</p>
            <div className={`mt-5 border border-white/10 bg-white/[0.025] p-6 ${radiusClass}`}>
              <PublicSocialLinks links={links} />
            </div>
          </section>
        ) : null;

      default:
        return null;
    }
  }

  return (
    <CustomShell
      brand={studio.name}
      logoUrl={studio.logo_url}
      navLinks={navLinks}
      accent={layout.page_style?.palette?.accent || "#8f7cff"}
      navStyle={layout.page_style?.nav_style ?? "pill"}
      joinAction={headerJoinAction}
      links={links}
      footer={footer}
    >
      {sections.map((section, index) => renderSection(section, index))}
    </CustomShell>
  );
}
