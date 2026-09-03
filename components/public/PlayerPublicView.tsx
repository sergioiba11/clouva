import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Crown,
  Images,
  Mail,
  MapPin,
  Music2,
  Play,
  ShoppingBag,
  Video,
} from "lucide-react";
import { PlayerOwnerActions } from "./PlayerOwnerActions";
import { PlayerSessionLocationCard } from "./PlayerSessionLocationCard";
import { PublicMediaGallery } from "./PublicMediaGallery";
import { PublicSocialLinks } from "./PublicSocialLinks";
import { PublicSpotifyPlayer } from "./PublicSpotifyPlayer";
import { PublicYouTubeFeatured } from "./PublicYouTubeFeatured";
import { PublicShell } from "./PublicShell";
import { VISUAL_ASSETS } from "@/lib/visual-assets";
import type { LayoutConfig, RadiusValue } from "@/lib/server/layout-config";
import {
  parsePlayerSocialLinks,
  type Player,
  type PlayerMedia,
  type PlayerStudioAffiliation,
  type SocialLink,
} from "@/lib/players-data";
import { normalizeSocialPlatform } from "@/lib/social-platforms";

const PLAYER_RADIUS_CLASS: Record<RadiusValue, string> = {
  none: "rounded-none",
  small: "rounded-lg",
  medium: "rounded-2xl",
  large: "rounded-[2.5rem]",
};

function mergeSocialLinks(player: Player) {
  const links = parsePlayerSocialLinks(player.social_links);
  const seen = new Set(links.map((link) => normalizeSocialPlatform(link.platform)));
  const append = (platform: string, url: string | null, label: string) => {
    const normalized = normalizeSocialPlatform(platform);
    if (url && !seen.has(normalized)) {
      links.push({ platform: normalized, url, label, is_visible: true, display_order: links.length });
      seen.add(normalized);
    }
  };
  append("spotify", player.spotify_profile_url, "Spotify");
  append("youtube", player.youtube_channel_url, "YouTube");
  if (player.contact_email) append("contact", `mailto:${player.contact_email}`, "Contacto");
  return links as SocialLink[];
}

function MediaCard({ item, radiusClass }: { item: PlayerMedia; radiusClass: string }) {
  const image = item.thumbnail_url || item.public_url;
  const target = item.source_url || item.public_url || "#";
  return (
    <a
      href={target}
      target={target === "#" ? undefined : "_blank"}
      rel={target === "#" ? undefined : "noopener noreferrer"}
      className={`group min-w-0 overflow-hidden border border-white/10 bg-white/[0.025] transition hover:border-[color:var(--public-accent)]/40 ${radiusClass}`}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-white/[0.03]">
        {image ? <img src={image} alt={item.caption || "Contenido de Player"} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" /> : null}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
        {item.media_type === "video" || item.media_type === "audio" ? (
          <span className="absolute inset-0 m-auto grid h-10 w-10 place-items-center rounded-full border border-white/25 bg-black/55 backdrop-blur">
            <Play size={15} fill="currentColor" />
          </span>
        ) : null}
      </div>
      <div className="p-3.5">
        <p className="truncate text-sm font-semibold">{item.caption || (item.media_type === "video" ? "Video" : "Contenido")}</p>
        <p className="mt-1 text-[10px] uppercase tracking-wider text-white/35">{item.origin || item.media_type}</p>
      </div>
    </a>
  );
}

export function PlayerPublicView({
  player,
  affiliations,
  media,
  isVip,
  hasMerch = false,
  layoutConfig = null,
}: {
  player: Player;
  affiliations: PlayerStudioAffiliation[];
  media: PlayerMedia[];
  isVip: boolean;
  hasMerch?: boolean;
  layoutConfig?: LayoutConfig | null;
}) {
  const categories = [...new Set([
    ...(player.professional_categories || []),
    ...(player.disciplines || []),
    ...(player.primary_role ? [player.primary_role] : []),
  ])].filter(Boolean);
  const primaryStudio = affiliations.find((entry) => entry.is_primary && entry.studio)?.studio || affiliations.find((entry) => entry.studio)?.studio;
  const socialLinks = mergeSocialLinks(player);
  const youtubeFeatured = media.find((item) => item.origin === "youtube" && (item.media_type === "video" || item.media_type === "embed")) || null;
  const featuredMedia = media
    .filter((item) => item.id !== youtubeFeatured?.id && (item.media_type === "audio" || item.media_type === "video" || item.media_type === "embed"))
    .slice(0, youtubeFeatured ? 3 : 4);
  const cover = player.cover_url || player.hero_image_url || VISUAL_ASSETS["player-public-profile-cover-01"];
  const location = player.location || player.origin;
  const radiusClass = PLAYER_RADIUS_CLASS[layoutConfig?.page_style?.radius ?? "medium"];
  const accent = layoutConfig?.page_style?.palette?.accent || player.accent_color || "#8f7cff";
  const locationAccent = player.accent_color || "#7ddfff";
  const navStyle = layoutConfig?.page_style?.nav_style ?? "pill";
  const hasLocationMap = Boolean(
    player.location
      && Number.isFinite(player.latitude)
      && Number.isFinite(player.longitude),
  );

  return (
    <PublicShell
      brand="LA MATRIX"
      brandHref="/matrix"
      accent={accent}
      navStyle={navStyle}
      navLinks={[
        { label: "Inicio", href: "/" },
        { label: "Players", href: "/players" },
        { label: "Estudios", href: "/studios" },
        { label: "Sellos", href: "#sellos", disabled: true },
        { label: "Colectivos", href: "#colectivos", disabled: true },
        { label: "Mundos", href: "#mundos", disabled: true },
      ]}
    >
      <section className="relative isolate overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 -z-30 bg-cover bg-center" style={{ backgroundImage: `url(${cover})` }} aria-hidden="true" />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,#07060b_0%,rgba(7,6,11,.94)_35%,rgba(7,6,11,.28)_70%,#07060b_100%)]" />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(0deg,#07060b_0%,transparent_50%)]" />

        <div className="mx-auto grid min-h-[36rem] max-w-7xl gap-8 px-4 py-9 sm:px-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-center">
          <div>
            <p className="mb-6 text-xs font-semibold uppercase tracking-[0.22em] text-[color:var(--public-accent)]/80">
              Players <span className="mx-2 text-white/25">›</span> {player.display_name}
            </p>

            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="relative shrink-0">
                {player.profile_image_url ? (
                  <img src={player.profile_image_url} alt={player.display_name} className="h-28 w-28 rounded-full border-2 border-[color:var(--public-accent)]/60 object-cover shadow-[0_0_35px_rgba(124,58,237,.35)] sm:h-36 sm:w-36" />
                ) : (
                  <div className="grid h-28 w-28 place-items-center rounded-full border-2 border-[color:var(--public-accent)]/60 bg-[color:var(--public-accent)]/20 text-4xl font-black sm:h-36 sm:w-36">{player.display_name.charAt(0)}</div>
                )}
                {player.is_verified ? <span className="absolute bottom-1 right-1 grid h-8 w-8 place-items-center rounded-full border-2 border-[#07060b] bg-[color:var(--public-accent)] text-white"><CheckCircle2 size={17} /></span> : null}
                {player.logo_url ? <img src={player.logo_url} alt="" className="absolute bottom-1 left-1 h-8 w-8 rounded-full border-2 border-[#07060b] bg-black/60 object-contain p-1" /> : null}
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-5xl font-black tracking-[-0.06em] sm:text-7xl">{player.display_name}</h1>
                  {isVip ? <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--public-accent)]/35 bg-[color:var(--public-accent)]/15 px-3 py-1.5 text-xs font-semibold text-[color:var(--public-accent)]"><Crown size={14} /> VIP</span> : null}
                </div>
                {player.tagline || player.short_bio ? <p className="mt-3 text-lg font-semibold text-[color:var(--public-accent)] sm:text-xl">{player.tagline || player.short_bio}</p> : null}
                <p className="mt-2 text-sm text-white/65">{[player.primary_role, ...(player.genres || []).slice(0, 2)].filter(Boolean).join(" · ")}</p>
                {location ? <p className="mt-2 flex items-center gap-2 text-sm text-white/45"><MapPin size={14} className="text-[color:var(--public-accent)]" /> {location}</p> : null}
              </div>
            </div>

            {primaryStudio || hasMerch ? (
              <div className="mt-6 flex flex-wrap gap-3">
                {primaryStudio ? (
                  <Link href={`/studios/${primaryStudio.slug}`} className={`inline-flex min-w-[220px] items-center gap-3 border border-white/12 bg-black/35 px-4 py-3 backdrop-blur transition hover:border-[color:var(--public-accent)]/45 ${radiusClass}`}>
                    {primaryStudio.logo_url ? <img src={primaryStudio.logo_url} alt="" className="h-10 w-10 rounded-full object-cover" /> : <span className="grid h-10 w-10 place-items-center rounded-full bg-[color:var(--public-accent)]/15"><Building2 size={17} /></span>}
                    <span className="min-w-0 flex-1"><b className="block truncate text-sm">{primaryStudio.name}</b><small className="text-white/40">Estudio principal</small></span>
                    <ArrowRight size={15} className="text-[color:var(--public-accent)]" />
                  </Link>
                ) : null}
                {hasMerch ? (
                  <a href="#merch" className={`inline-flex min-w-[220px] items-center gap-3 border border-white/12 bg-black/35 px-4 py-3 backdrop-blur transition hover:border-[color:var(--public-accent)]/45 ${radiusClass}`}>
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-[color:var(--public-accent)]/15"><ShoppingBag size={17} /></span>
                    <span className="min-w-0 flex-1"><b className="block text-sm">Mi merch</b><small className="text-white/40">Comprá mis productos</small></span>
                    <ArrowRight size={15} className="text-[color:var(--public-accent)]" />
                  </a>
                ) : null}
              </div>
            ) : null}

            <PlayerOwnerActions ownerUserId={player.owner_user_id} />

            <div className="mt-6 flex flex-wrap gap-2">
              {player.spotify_profile_url ? <a href="#musica" className="inline-flex items-center gap-2 rounded-full bg-[color:var(--public-accent)] px-5 py-2.5 text-sm font-semibold transition hover:opacity-90"><Play size={15} fill="currentColor" /> Escuchar música</a> : null}
              {media.length ? <a href="#galeria" className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-5 py-2.5 text-sm font-semibold transition hover:border-[color:var(--public-accent)]/50"><Images size={15} /> Ver contenido</a> : null}
              {player.contact_email ? <a href={`mailto:${player.contact_email}`} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-5 py-2.5 text-sm font-semibold transition hover:border-[color:var(--public-accent)]/50"><Mail size={15} /> Contactar</a> : null}
            </div>

            {socialLinks.length ? <div className="mt-4"><PublicSocialLinks links={socialLinks} playerName={player.display_name} /></div> : null}
          </div>

          <div className="grid self-center justify-items-end gap-3">
            {hasLocationMap ? (
              <PlayerSessionLocationCard
                ownerUserId={player.owner_user_id}
                latitude={player.latitude}
                longitude={player.longitude}
                label={player.location || ""}
                accent={locationAccent}
              />
            ) : null}

            <aside className={`w-full border border-white/12 bg-[#0c0b16]/80 p-5 shadow-2xl backdrop-blur-xl ${radiusClass}`}>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[color:var(--public-accent)]/70">Identidad en La Matrix</p>
              <div className="mt-5 grid gap-4">
                <div className="flex gap-3"><Music2 size={17} className="mt-0.5 text-[color:var(--public-accent)]" /><p><small className="block text-[10px] uppercase tracking-wider text-white/35">Rol</small><b className="text-sm">{player.primary_role || "Player"}</b></p></div>
                {player.genres?.length ? <div className="flex gap-3"><Play size={17} className="mt-0.5 text-[color:var(--public-accent)]" /><p><small className="block text-[10px] uppercase tracking-wider text-white/35">Género</small><b className="text-sm">{player.genres.slice(0, 3).join(" · ")}</b></p></div> : null}
                {location ? <div className="flex gap-3"><MapPin size={17} className="mt-0.5 text-[color:var(--public-accent)]" /><p><small className="block text-[10px] uppercase tracking-wider text-white/35">Origen</small><b className="text-sm">{location}</b></p></div> : null}
                <div className="grid grid-cols-2 gap-2 border-t border-white/10 pt-4">
                  <p className="rounded-xl bg-white/[0.035] p-3"><b className="block text-lg">{affiliations.length}</b><small className="text-[10px] text-white/40">Estudios</small></p>
                  <p className="rounded-xl bg-white/[0.035] p-3"><b className="block text-lg">{media.length}</b><small className="text-[10px] text-white/40">Contenidos</small></p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {player.spotify_profile_url ? <PublicSpotifyPlayer spotifyUrl={player.spotify_profile_url} artistName={player.display_name} /> : null}

      <section id="presentacion" className="mx-auto grid max-w-7xl gap-4 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,.9fr)_minmax(0,1.4fr)_280px]">
        <article className={`border border-white/10 bg-white/[0.025] p-5 ${radiusClass}`}>
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--public-accent)]/70">Sobre {player.display_name}</p>
          {player.long_bio || player.short_bio ? <p className="mt-4 whitespace-pre-line text-sm leading-6 text-white/62">{player.long_bio || player.short_bio}</p> : <p className="mt-4 text-sm text-white/40">Este Player todavía está completando su presentación.</p>}
          {player.secondary_tagline ? <p className="mt-4 border-l-2 border-[color:var(--public-accent)] pl-3 text-sm italic text-[color:var(--public-accent)]">{player.secondary_tagline}</p> : null}
          {categories.length ? <div className="mt-5 flex flex-wrap gap-2">{categories.slice(0, 6).map((label) => <span key={label} className="rounded-full border border-[color:var(--public-accent)]/15 bg-[color:var(--public-accent)]/10 px-2.5 py-1 text-[10px] text-[color:var(--public-accent)]">{label}</span>)}</div> : null}
        </article>

        <section className={`border border-white/10 bg-white/[0.025] p-5 ${radiusClass}`}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Video size={16} className="text-[color:var(--public-accent)]" /> Contenido destacado</h2>
            {media.length ? <a href="#galeria" className="text-[10px] text-[color:var(--public-accent)]">Ver todo</a> : null}
          </div>
          {youtubeFeatured ? <PublicYouTubeFeatured item={youtubeFeatured} radiusClass={radiusClass} /> : null}
          {featuredMedia.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{featuredMedia.map((item) => <MediaCard key={item.id} item={item} radiusClass={radiusClass} />)}</div> : youtubeFeatured ? null : <div className={`grid min-h-44 place-items-center border border-dashed border-white/10 text-center text-xs text-white/35 ${radiusClass}`}>El contenido destacado aparecerá cuando el Player lo publique.</div>}
        </section>

        <aside className={`border border-white/10 bg-white/[0.025] p-5 ${radiusClass}`}>
          <div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Estudios conectados</h2><Building2 size={16} className="text-[color:var(--public-accent)]" /></div>
          {affiliations.length ? (
            <div className="mt-4 grid gap-2">
              {affiliations.map((entry) => entry.studio ? (
                <Link key={entry.studio.id} href={`/studios/${entry.studio.slug}`} className="flex items-center gap-3 rounded-xl border border-white/[0.07] p-2.5 transition hover:border-[color:var(--public-accent)]/35">
                  {entry.studio.logo_url ? <img src={entry.studio.logo_url} alt="" className="h-9 w-9 rounded-full object-cover" /> : <span className="grid h-9 w-9 place-items-center rounded-full bg-[color:var(--public-accent)]/10 text-xs">{entry.studio.name.charAt(0)}</span>}
                  <span className="min-w-0 flex-1"><b className="block truncate text-xs">{entry.studio.name}</b><small className="text-[10px] text-white/35">{entry.role || "Miembro"}</small></span>
                  <ArrowRight size={13} className="text-white/30" />
                </Link>
              ) : null)}
            </div>
          ) : <p className="mt-4 text-xs leading-5 text-white/35">Este Player todavía no publicó conexiones con Estudios.</p>}
        </aside>
      </section>

      <PublicMediaGallery media={media} />
    </PublicShell>
  );
}
