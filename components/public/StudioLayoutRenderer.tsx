import Link from "next/link";
import { PublicMediaGallery } from "./PublicMediaGallery";
import { PublicShareButton } from "./PublicShareButton";
import { PublicSocialLinks } from "./PublicSocialLinks";
import { PublicShell, type PublicNavLink } from "./PublicShell";
import { StudioServicesCart } from "./StudioServicesCart";
import { StudioManageButton } from "./StudioManageButton";
import { formatPlanPrice, studioSocialLinks } from "./StudioPublicView";
import type { HeroSection, LayoutConfig, LayoutSection, LayoutSectionType, RadiusValue } from "@/lib/server/layout-config";
import type { PlayerMedia, StudioMembershipPlan, StudioPlayer, StudioRow, StudioService } from "@/lib/players-data";

const SECTION_ANCHOR: Record<LayoutSectionType, string> = {
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

const SECTION_NAV_LABEL: Record<LayoutSectionType, string> = {
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

const RADIUS_CLASS: Record<RadiusValue, string> = {
  none: "rounded-none",
  small: "rounded-lg",
  medium: "rounded-2xl",
  large: "rounded-[2.5rem]",
};

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
  services,
  membershipPlans = [],
  joined = false,
  layout,
}: {
  studio: StudioRow;
  players: StudioPlayer[];
  media: PlayerMedia[];
  projects: Array<Record<string, unknown>>;
  services: StudioService[];
  membershipPlans?: StudioMembershipPlan[];
  joined?: boolean;
  layout: LayoutConfig;
}) {
  const links = studioSocialLinks(studio);
  const defaultMembershipPlan = membershipPlans.find((plan) => plan.is_free) ?? membershipPlans[0] ?? null;
  const joinHref = defaultMembershipPlan
    ? `/studios/${studio.slug}/checkout${defaultMembershipPlan.is_free ? "" : `?plan=${defaultMembershipPlan.slug}`}`
    : `/studios/${studio.slug}/join`;
  const includedTypes = new Set(layout.sections.map((section) => section.type));
  const radiusClass = RADIUS_CLASS[layout.page_style?.radius ?? "medium"];
  const location = [studio.city, studio.country].filter(Boolean).join(", ");
  const primaryAction = { label: joined ? "Ya sos miembro" : "Quiero unirme", href: joined && includedTypes.has("roster") ? `#${SECTION_ANCHOR.roster}` : joinHref };
  const secondaryAction = players.length && includedTypes.has("roster") ? { label: "Conocer Players", href: `#${SECTION_ANCHOR.roster}` } : null;

  const navLinks: PublicNavLink[] = layout.nav_items?.length
    ? layout.nav_items.map((item) => ({ label: item.label, href: `#${SECTION_ANCHOR[item.section]}` }))
    : layout.sections
        .filter((section) => section.type !== "hero")
        .map((section) => ({ label: SECTION_NAV_LABEL[section.type], href: `#${SECTION_ANCHOR[section.type]}` }));

  const footer = layout.footer && includedTypes.has(layout.footer.cta_section) ? (
    <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 sm:flex-row sm:justify-between">
      <p className="text-sm text-white/60">{layout.footer.heading}</p>
      <Link href={`#${SECTION_ANCHOR[layout.footer.cta_section]}`} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500">
        {layout.footer.cta_label}
      </Link>
    </div>
  ) : undefined;

  function renderHero(section: HeroSection, index: number) {
    const badges = studio.categories || [];
    const initial = studio.name.trim().charAt(0).toUpperCase() || "C";
    const logo = studio.logo_url ? <img src={studio.logo_url} alt={studio.name} className={`h-16 w-16 shrink-0 border-4 border-[#07060b] object-cover shadow-xl ${radiusClass}`} /> : null;
    const actions = (
      <div className="flex flex-wrap gap-2">
        <Link href={primaryAction.href} className="rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold transition hover:bg-violet-500">{primaryAction.label}</Link>
        {secondaryAction ? <Link href={secondaryAction.href} className="rounded-full border border-white/15 bg-black/30 px-5 py-2.5 text-sm font-semibold transition hover:border-violet-400/60">{secondaryAction.label}</Link> : null}
        <PublicShareButton title={studio.name} />
      </div>
    );
    const badgeRow = badges.length ? (
      <div className="flex flex-wrap gap-2">
        {badges.map((badge) => <span key={badge} className="rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-xs text-violet-200">{badge}</span>)}
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
                {logo}
                <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.28em] text-violet-300/80">Estudio</p>
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
              <p className="text-xs font-semibold uppercase tracking-[0.4em] text-violet-300/80">Estudio</p>
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
            {studio.cover_url ? <img src={studio.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 bg-gradient-to-br from-violet-900/40 to-black" />}
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
            {studio.cover_url ? <img src={studio.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute inset-0 bg-gradient-to-br from-violet-900/40 to-black" />}
            <div className="absolute inset-0 bg-black/55" />
            <div className="relative flex flex-col items-center px-4">
              {logo}
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
              <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">{section.heading}</p>
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
              <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">Identidad</p>
              <h2 className="mt-1 text-2xl font-semibold">{section.heading}</h2>
              <div className="mt-6 divide-y divide-white/10 border-y border-white/10">
                {section.items.map((item, itemIndex) => (
                  <div key={itemIndex} className="flex items-start gap-5 py-5">
                    <span className="text-3xl font-black text-violet-400/60">{String(itemIndex + 1).padStart(2, "0")}</span>
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
            <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">Identidad</p>
            <h2 className="mt-1 text-2xl font-semibold">{section.heading}</h2>
            <div className={`mt-5 grid gap-4 ${columns}`}>
              {section.items.map((item, itemIndex) => (
                <article key={itemIndex} className={`border border-white/10 bg-white/[0.025] p-6 ${radiusClass}`}>
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-white/60">{item.description}</p>
                </article>
              ))}
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
            <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">Identidades</p>
            <h2 className="mt-1 text-2xl font-semibold">{section.heading || "Players"}</h2>
            {players.length === 0 ? (
              <div className={`mt-5 border border-dashed border-white/15 p-8 text-center text-white/45 ${radiusClass}`}>Próximos Players</div>
            ) : (
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {players.map((entry, playerIndex) => entry.player ? (
                  <Link key={`${entry.player.id}-${playerIndex}`} href={`/${entry.player.slug}`} className={`group flex items-center gap-4 border border-white/10 bg-white/[0.025] p-4 transition hover:border-violet-400/50 ${radiusClass}`}>
                    {entry.player.profile_image_url ? <img src={entry.player.profile_image_url} alt={entry.player.display_name} className={`h-16 w-16 object-cover ${radiusClass}`} /> : <div className={`flex h-16 w-16 items-center justify-center bg-violet-500/15 text-xl font-semibold ${radiusClass}`}>{entry.player.display_name.charAt(0)}</div>}
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
            <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">Formas de participar</p>
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
                  <Link href={`/studios/${studio.slug}/checkout${plan.is_free ? "" : `?plan=${plan.slug}`}`} className="mt-6 rounded-xl bg-violet-600 px-5 py-3 text-center text-sm font-semibold transition hover:bg-violet-500">
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
            <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">Contratar</p>
            <h2 className="mt-1 text-2xl font-semibold">{section.heading || "Servicios"}</h2>
            <div className="mt-5"><StudioServicesCart studioId={studio.id} studioSlug={studio.slug} services={services} /></div>
          </section>
        ) : null;

      case "music": {
        if (projects.length === 0) return null;
        const isList = section.variant === "list";
        const releases = projects.slice(0, section.variant === "featured-release" ? 1 : 6);
        return (
          <section key={index} id={SECTION_ANCHOR.music} className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">{section.heading || "Música y lanzamientos"}</p>
            <div className={isList ? "mt-5 space-y-3" : "mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"}>
              {releases.map((project) => (
                <article key={String(project.id)} className={`overflow-hidden border border-white/10 bg-white/[0.025] ${radiusClass} ${isList ? "flex items-center gap-4 p-3" : ""}`}>
                  {project.cover_url ? (
                    <img src={String(project.cover_url)} alt="" className={isList ? "h-14 w-14 shrink-0 rounded-lg object-cover" : "aspect-square w-full object-cover"} />
                  ) : null}
                  <div className={isList ? "min-w-0" : "p-4"}>
                    <p className="truncate font-semibold">{String(project.title || "Lanzamiento")}</p>
                    <div className="mt-1 flex gap-3 text-xs text-violet-300">
                      {project.spotify_url ? <a href={String(project.spotify_url)} target="_blank" rel="noreferrer">Spotify</a> : null}
                      {project.youtube_url ? <a href={String(project.youtube_url)} target="_blank" rel="noreferrer">YouTube</a> : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      }

      case "contact":
        return links.length ? (
          <section key={index} id={SECTION_ANCHOR.contact} className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">{section.heading || "Contacto"}</p>
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
    <PublicShell
      brand={studio.name}
      brandHref={`/studios/${studio.slug}`}
      navLinks={navLinks}
      accent={layout.page_style?.palette?.accent || "#8f7cff"}
      navStyle={layout.page_style?.nav_style ?? "pill"}
      footer={footer}
    >
      {layout.sections.map((section, index) => renderSection(section, index))}
    </PublicShell>
  );
}
