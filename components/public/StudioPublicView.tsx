import Link from "next/link";
import { PublicMediaGallery } from "./PublicMediaGallery";
import { PublicProfileHero } from "./PublicProfileHero";
import { PublicSocialLinks } from "./PublicSocialLinks";
import { PublicShell } from "./PublicShell";
import { StudioServicesCart } from "./StudioServicesCart";
import type { PlayerMedia, SocialLink, StudioMembershipPlan, StudioPlayer, StudioRow, StudioService } from "@/lib/players-data";

function formatPlanPrice(plan: StudioMembershipPlan) {
  if (plan.is_free) return "Gratis";
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: plan.currency, maximumFractionDigits: 0 }).format(Number(plan.price));
}

function studioSocialLinks(studio: StudioRow): SocialLink[] {
  const raw = Array.isArray(studio.social_links) ? studio.social_links : [];
  const links = raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      platform: String(item.platform || "website").toLowerCase(),
      label: typeof item.label === "string" ? item.label : undefined,
      url: typeof item.url === "string" ? item.url : "",
      is_visible: item.is_visible !== false,
      display_order: Number(item.display_order || 0),
    }))
    .filter((item) => item.url && item.is_visible);
  if (studio.website_url && !links.some((link) => link.url === studio.website_url)) {
    links.push({ platform: "website", label: "Sitio web", url: studio.website_url, is_visible: true, display_order: 99 });
  }
  if (studio.contact_email) {
    links.push({ platform: "contact", label: "Contacto", url: `mailto:${studio.contact_email}`, is_visible: true, display_order: 100 });
  }
  return links;
}

export function StudioPublicView({
  studio,
  players,
  media,
  projects,
  services,
  membershipPlans = [],
}: {
  studio: StudioRow;
  players: StudioPlayer[];
  media: PlayerMedia[];
  projects: Array<Record<string, unknown>>;
  services: StudioService[];
  membershipPlans?: StudioMembershipPlan[];
}) {
  const links = studioSocialLinks(studio);
  return (
    <PublicShell
      brand={studio.name}
      brandHref={`/studios/${studio.slug}`}
      navLinks={[
        { label: "Sobre", href: "#sobre" },
        { label: "Players", href: "#players" },
        ...(membershipPlans.length ? [{ label: "Membresías", href: "#membresias" }] : []),
        ...(services.length ? [{ label: "Servicios", href: "#servicios" }] : []),
        ...(projects.length ? [{ label: "Proyectos", href: "#proyectos" }] : []),
        ...(media.length ? [{ label: "Galería", href: "#galeria" }] : []),
      ]}
    >
      <PublicProfileHero
        kind="studio"
        name={studio.name}
        tagline={studio.tagline || studio.description}
        location={[studio.city, studio.country].filter(Boolean).join(", ")}
        profileImageUrl={studio.logo_url}
        coverUrl={studio.cover_url}
        badges={studio.categories || []}
        primaryAction={{ label: "Quiero unirme", href: `/studios/${studio.slug}/join` }}
        secondaryAction={players.length ? { label: "Conocer Players", href: "#players" } : null}
      />

      <section id="sobre" className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <article className="rounded-[2rem] border border-white/10 bg-white/[0.025] p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">Sobre el Estudio</p>
          <h2 className="mt-2 text-2xl font-semibold">{studio.name}</h2>
          {studio.description ? <p className="mt-5 whitespace-pre-line leading-8 text-white/70">{studio.description}</p> : <p className="mt-5 text-white/45">Este Estudio todavía está completando su presentación.</p>}
        </article>
        {links.length ? (
          <aside className="rounded-[2rem] border border-white/10 bg-white/[0.025] p-6">
            <p className="mb-4 text-xs uppercase tracking-[0.24em] text-white/40">Links oficiales</p>
            <PublicSocialLinks links={links} />
          </aside>
        ) : null}
      </section>

      <section id="players" className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">Identidades</p>
        <h2 className="mt-1 text-2xl font-semibold">Players</h2>
        {players.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-white/15 p-8 text-center text-white/45">Próximos Players</div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {players.map((entry, index) => entry.player ? (
              <Link key={`${entry.player.id}-${index}`} href={`/${entry.player.slug}`} className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4 transition hover:border-violet-400/50">
                {entry.player.profile_image_url ? <img src={entry.player.profile_image_url} alt={entry.player.display_name} className="h-16 w-16 rounded-2xl object-cover" /> : <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500/15 text-xl font-semibold">{entry.player.display_name.charAt(0)}</div>}
                <div className="min-w-0">
                  <p className="truncate font-semibold">{entry.player.display_name}</p>
                  <p className="mt-1 text-sm text-white/45">{entry.role || entry.player.primary_role || "Player"}</p>
                </div>
              </Link>
            ) : null)}
          </div>
        )}
      </section>

      {membershipPlans.length ? (
        <section id="membresias" className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">Comunidad</p>
          <h2 className="mt-1 text-2xl font-semibold">Membresías</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {membershipPlans.map((plan) => (
              <article key={plan.id} className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.025] p-6">
                <h3 className="font-semibold">{plan.name}</h3>
                {plan.description ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-white/55">{plan.description}</p> : null}
                <p className="mt-4 text-2xl font-bold">
                  {formatPlanPrice(plan)}
                  {!plan.is_free ? <span className="ml-1 text-sm font-normal text-white/45">/ {plan.billing_interval === "year" ? "año" : "mes"}</span> : null}
                </p>
                {plan.benefits.length ? (
                  <ul className="mt-4 space-y-1.5 text-sm text-white/60">
                    {plan.benefits.slice(0, 4).map((benefit, index) => (
                      <li key={index} className="flex gap-2">
                        <span className="text-violet-300">✓</span>
                        {benefit}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <Link
                  href={`/studios/${studio.slug}/checkout${plan.is_free ? "" : `?plan=${plan.slug}`}`}
                  className="mt-6 rounded-xl bg-violet-600 px-5 py-3 text-center text-sm font-semibold transition hover:bg-violet-500"
                >
                  {plan.is_free ? "Unirme gratis" : "Ser socio"}
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {services.length ? (
        <section id="servicios" className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">Contratar</p>
          <h2 className="mt-1 text-2xl font-semibold">Servicios</h2>
          <div className="mt-5">
            <StudioServicesCart studioId={studio.id} studioSlug={studio.slug} services={services} />
          </div>
        </section>
      ) : null}

      {projects.length ? (
        <section id="proyectos" className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">Obras</p>
          <h2 className="mt-1 text-2xl font-semibold">Proyectos</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <article key={String(project.id)} className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.025]">
                {project.cover_url ? <img src={String(project.cover_url)} alt={String(project.title || "Proyecto")} className="aspect-video w-full object-cover" /> : null}
                <div className="p-5">
                  <h3 className="font-semibold">{String(project.title || "Proyecto")}</h3>
                  {project.description ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-white/55">{String(project.description)}</p> : null}
                  <div className="mt-4 flex gap-3 text-sm text-violet-300">
                    {project.spotify_url ? <a href={String(project.spotify_url)} target="_blank" rel="noreferrer">Spotify</a> : null}
                    {project.youtube_url ? <a href={String(project.youtube_url)} target="_blank" rel="noreferrer">YouTube</a> : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <PublicMediaGallery media={media} />
    </PublicShell>
  );
}
