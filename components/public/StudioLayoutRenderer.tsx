import Link from "next/link";
import { PublicMediaGallery } from "./PublicMediaGallery";
import { PublicProfileHero } from "./PublicProfileHero";
import { PublicSocialLinks } from "./PublicSocialLinks";
import { PublicShell, type PublicNavLink } from "./PublicShell";
import { StudioServicesCart } from "./StudioServicesCart";
import { StudioManageButton } from "./StudioManageButton";
import { formatPlanPrice, studioSocialLinks } from "./StudioPublicView";
import type { LayoutConfig, LayoutSection, LayoutSectionType, MusicEmbed } from "@/lib/server/layout-config";
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

// Convierte una URL ya validada (sanitizeLayoutConfig solo deja pasar
// dominios de Spotify/YouTube) a su forma embebible -- nunca renderiza un
// <iframe> con un src que no haya pasado por esa validación.
function toEmbedSrc(embed: MusicEmbed): string {
  if (embed.provider === "spotify") {
    return embed.url.includes("/embed/") ? embed.url : embed.url.replace("open.spotify.com/", "open.spotify.com/embed/");
  }
  const watchMatch = embed.url.match(/[?&]v=([\w-]+)/);
  if (watchMatch) return `https://www.youtube.com/embed/${watchMatch[1]}`;
  const shortMatch = embed.url.match(/youtu\.be\/([\w-]+)/);
  if (shortMatch) return `https://www.youtube.com/embed/${shortMatch[1]}`;
  return embed.url;
}

// Contraparte de StudioPublicView.tsx cuando el Estudio tiene un
// layout_config real (mockup replicado o variante elegida): mismo shell,
// mismos datos reales (players/servicios/planes/galería), pero el orden,
// inclusión y copy de cada sección vienen del layout en vez de estar
// hardcodeados. Nunca renderiza HTML/markup que venga de layout_config --
// solo texto plano (React escapa) y, para "music", un src de iframe ya
// validado contra un allowlist de dominios en sanitizeLayoutConfig.
export function StudioLayoutRenderer({
  studio,
  players,
  media,
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

  const navLinks: PublicNavLink[] = layout.nav_items?.length
    ? layout.nav_items.map((item) => ({ label: item.label, href: `#${SECTION_ANCHOR[item.section]}` }))
    : layout.sections
        .filter((section) => section.type !== "hero")
        .map((section) => ({ label: SECTION_NAV_LABEL[section.type], href: `#${SECTION_ANCHOR[section.type]}` }));

  function renderSection(section: LayoutSection, index: number) {
    switch (section.type) {
      case "hero":
        return (
          <div key={index} id={SECTION_ANCHOR.hero}>
            <PublicProfileHero
              kind="studio"
              name={studio.name}
              tagline={section.subheadline || section.headline}
              location={[studio.city, studio.country].filter(Boolean).join(", ")}
              profileImageUrl={studio.logo_url}
              coverUrl={studio.cover_url}
              badges={studio.categories || []}
              primaryAction={{ label: joined ? "Ya sos miembro" : "Quiero unirme", href: joined && includedTypes.has("roster") ? `#${SECTION_ANCHOR.roster}` : joinHref }}
              secondaryAction={players.length && includedTypes.has("roster") ? { label: "Conocer Players", href: `#${SECTION_ANCHOR.roster}` } : null}
            />
            {joined ? (
              <div className="mx-auto -mt-6 max-w-6xl px-4 sm:px-6">
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
            <article className={`rounded-[2rem] border border-white/10 bg-white/[0.025] p-6 sm:p-8 ${showAside ? "" : "mx-auto max-w-3xl text-center"}`}>
              <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">{section.heading}</p>
              <h2 className="mt-2 text-2xl font-semibold">{studio.name}</h2>
              <p className="mt-5 whitespace-pre-line leading-8 text-white/70">{section.body}</p>
            </article>
            {showAside ? (
              <aside className="rounded-[2rem] border border-white/10 bg-white/[0.025] p-6">
                <p className="mb-4 text-xs uppercase tracking-[0.24em] text-white/40">Links oficiales</p>
                <PublicSocialLinks links={links} />
              </aside>
            ) : null}
          </section>
        );
      }

      case "pillars": {
        const columns = section.variant === "4-cards" ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3";
        return (
          <section key={index} id={SECTION_ANCHOR.pillars} className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">Identidad</p>
            <h2 className="mt-1 text-2xl font-semibold">{section.heading}</h2>
            <div className={`mt-5 grid gap-4 ${columns}`}>
              {section.items.map((item, itemIndex) => (
                <article key={itemIndex} className="rounded-2xl border border-white/10 bg-white/[0.025] p-6">
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
              <div className="mt-5 rounded-2xl border border-dashed border-white/15 p-8 text-center text-white/45">Próximos Players</div>
            ) : (
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {players.map((entry, playerIndex) => entry.player ? (
                  <Link key={`${entry.player.id}-${playerIndex}`} href={`/${entry.player.slug}`} className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4 transition hover:border-violet-400/50">
                    {entry.player.profile_image_url ? <img src={entry.player.profile_image_url} alt={entry.player.display_name} className="h-16 w-16 rounded-2xl object-cover" /> : <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/15 text-xl font-semibold">{entry.player.display_name.charAt(0)}</div>}
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
                <article key={plan.id} className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.025] p-6">
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

      case "music":
        return (
          <section key={index} id={SECTION_ANCHOR.music} className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">{section.heading || "Sonando ahora"}</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {section.embeds.map((embed, embedIndex) => (
                <iframe
                  key={embedIndex}
                  src={toEmbedSrc(embed)}
                  className="aspect-video w-full rounded-2xl border border-white/10"
                  loading="lazy"
                  allow="encrypted-media"
                />
              ))}
            </div>
          </section>
        );

      case "contact":
        return links.length ? (
          <section key={index} id={SECTION_ANCHOR.contact} className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
            <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">{section.heading || "Contacto"}</p>
            <div className="mt-5 rounded-[2rem] border border-white/10 bg-white/[0.025] p-6">
              <PublicSocialLinks links={links} />
            </div>
          </section>
        ) : null;

      default:
        return null;
    }
  }

  return (
    <PublicShell brand={studio.name} brandHref={`/studios/${studio.slug}`} navLinks={navLinks} accent={layout.page_style?.palette?.accent || "#8f7cff"}>
      {layout.sections.map((section, index) => renderSection(section, index))}
    </PublicShell>
  );
}
