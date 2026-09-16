import {
  parsePlayerSocialLinks,
  type Player,
  type PlayerMusicConnection,
} from "@/lib/players-data";
import { isPublicHttpUrl } from "@/lib/seo/structured-data";

const SITE_URL = "https://clouva.com.ar";

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item == null) return false;
      if (Array.isArray(item)) return item.length > 0;
      if (typeof item === "string") return item.trim().length > 0;
      return true;
    }),
  ) as T;
}

function uniquePublicUrls(values: Array<string | null | undefined>) {
  return [...new Set(values.filter(isPublicHttpUrl))];
}

export function buildPlayerStructuredData({
  player,
  canonicalAlias,
  musicConnections = [],
}: {
  player: Player;
  canonicalAlias: string;
  musicConnections?: PlayerMusicConnection[];
}) {
  const canonical = `${SITE_URL}/${canonicalAlias}`;
  const personId = `${canonical}#person`;
  const profileId = `${canonical}#profile`;
  const description =
    player.seo_description ||
    player.long_bio ||
    player.share_description ||
    player.short_bio ||
    player.tagline ||
    undefined;
  const image = player.profile_image_url || player.og_image_url || player.cover_url || undefined;
  const socialUrls = parsePlayerSocialLinks(player.social_links).map((link) => link.url);
  const musicUrls = musicConnections.map((connection) => connection.external_url);
  const sameAs = uniquePublicUrls([
    ...socialUrls,
    player.spotify_profile_url,
    player.youtube_channel_url,
    ...musicUrls,
  ]);
  const knowsAbout = [...new Set((player.genres || []).map((genre) => genre.trim()).filter(Boolean))];
  const alternateName = [...new Set((player.alternate_names || []).map((name) => name.trim()).filter(Boolean))];

  const person = compact({
    "@type": "Person",
    "@id": personId,
    name: player.display_name,
    alternateName,
    url: canonical,
    description,
    image,
    jobTitle: player.schema_job_title || undefined,
    nationality: player.country
      ? { "@type": "Country", name: player.country }
      : undefined,
    birthPlace: player.birth_place
      ? { "@type": "Place", name: player.birth_place }
      : undefined,
    homeLocation: player.location
      ? { "@type": "Place", name: player.location }
      : undefined,
    knowsAbout,
    sameAs,
  });

  const profilePage = compact({
    "@type": "ProfilePage",
    "@id": profileId,
    url: canonical,
    name: player.seo_title || `${player.display_name} — Perfil oficial`,
    description,
    mainEntity: { "@id": personId },
  });

  return {
    "@context": "https://schema.org",
    "@graph": [profilePage, person],
  };
}
