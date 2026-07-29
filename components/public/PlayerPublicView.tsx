import Link from "next/link";
import { PublicMediaGallery } from "./PublicMediaGallery";
import { PublicProfileHero } from "./PublicProfileHero";
import { PublicSocialLinks } from "./PublicSocialLinks";
import { PublicShell } from "./PublicShell";
import {
  parsePlayerSocialLinks,
  type Player,
  type PlayerMedia,
  type PlayerStudioAffiliation,
  type SocialLink,
} from "@/lib/players-data";

function mergeSocialLinks(player: Player) {
  const links = parsePlayerSocialLinks(player.social_links);
  const seen = new Set(links.map((link) => link.platform));
  const append = (platform: string, url: string | null, label: string) => {
    if (url && !seen.has(platform)) {
      links.push({ platform, url, label, is_visible: true, display_order: links.length });
      seen.add(platform);
    }
  };
  append("spotify", player.spotify_profile_url, "Spotify");
  append("youtube", player.youtube_channel_url, "YouTube");
  if (player.contact_email) append("contact", `mailto:${player.contact_email}`, "Contacto");
  return links as SocialLink[];
}

export function PlayerPublicView({
  player,
  affiliations,
  media,
  isVip,
}: {
  player: Player;
  affiliations: PlayerStudioAffiliation[];
  media: PlayerMedia[];
  isVip: boolean;
}) {
  const categories = [...new Set([
    ...(player.professional_categories || []),
    ...(player.disciplines || []),
    ...(player.primary_role ? [player.primary_role] : []),
    ...(isVip ? ["VIP"] : []),
  ])].filter(Boolean);
  const primaryStudio = affiliations.find((entry) => entry.is_primary && entry.studio)?.studio || affiliations.find((entry) => entry.studio)?.studio;
  const socialLinks = mergeSocialLinks(player);

  return (
    <PublicShell
      brand={player.display_name}
      brandHref={`/${player.slug}`}
      accent={player.accent_color || "#8f7cff"}
      navLinks={[
        { label: "Presentación", href: "#presentacion" },
        ...(media.length ? [{ label: "Galería", href: "#galeria" }] : []),
        ...(affiliations.length ? [{ label: "Estudios", href: "#estudios" }] : []),
      ]}
    >
      <PublicProfileHero
        kind="player"
        name={player.display_name}
        username={player.username}
        tagline={player.tagline || player.short_bio}
        location={player.location || player.origin}
        profileImageUrl={player.profile_image_url}
        coverUrl={player.cover_url || player.hero_image_url}
        badges={categories}
        primaryAction={player.spotify_profile_url ? { label: "Escuchar música", href: player.spotify_profile_url } : null}
        secondaryAction={primaryStudio ? { label: primaryStudio.name, href: `/studios/${primaryStudio.slug}` } : null}
      />

      <section id="presentacion" className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <article className="rounded-[2rem] border border-white/10 bg-white/[0.025] p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">Presentación</p>
          <h2 className="mt-2 text-2xl font-semibold">Sobre {player.display_name}</h2>
          {player.long_bio || player.short_bio ? (
            <p className="mt-5 whitespace-pre-line leading-8 text-white/70">{player.long_bio || player.short_bio}</p>
          ) : (
            <p className="mt-5 text-white/45">Este Player todavía está completando su presentación.</p>
          )}
          {player.secondary_tagline ? <p className="mt-6 border-l-2 border-violet-500 pl-4 text-lg text-white/80">{player.secondary_tagline}</p> : null}
        </article>

        <aside className="space-y-4">
          {socialLinks.length > 0 ? (
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.025] p-6">
              <p className="mb-4 text-xs uppercase tracking-[0.24em] text-white/40">Links oficiales</p>
              <PublicSocialLinks links={socialLinks} />
            </div>
          ) : null}
          {primaryStudio ? (
            <Link href={`/studios/${primaryStudio.slug}`} className="block rounded-[2rem] border border-violet-400/20 bg-violet-500/10 p-6 transition hover:border-violet-400/50">
              <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">Estudio principal</p>
              <div className="mt-4 flex items-center gap-3">
                {primaryStudio.logo_url ? <img src={primaryStudio.logo_url} alt={primaryStudio.name} className="h-12 w-12 rounded-xl object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-black/30 font-semibold">{primaryStudio.name.charAt(0)}</div>}
                <div>
                  <p className="font-semibold">{primaryStudio.name}</p>
                  <p className="text-xs text-white/45">Ver estudio</p>
                </div>
              </div>
            </Link>
          ) : null}
        </aside>
      </section>

      <PublicMediaGallery media={media} />

      {affiliations.length > 0 ? (
        <section id="estudios" className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
          <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">Trayectoria</p>
          <h2 className="mt-1 text-2xl font-semibold">Mis Estudios</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {affiliations.map((entry) => entry.studio ? (
              <Link key={entry.studio.id} href={`/studios/${entry.studio.slug}`} className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4 transition hover:border-violet-400/50">
                {entry.studio.logo_url ? <img src={entry.studio.logo_url} alt={entry.studio.name} className="h-14 w-14 rounded-xl object-cover" /> : <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-violet-500/15 font-semibold">{entry.studio.name.charAt(0)}</div>}
                <div className="min-w-0">
                  <p className="truncate font-semibold">{entry.studio.name}</p>
                  <p className="text-sm text-white/45">{entry.role || "Miembro"}</p>
                </div>
              </Link>
            ) : null)}
          </div>
        </section>
      ) : null}
    </PublicShell>
  );
}
