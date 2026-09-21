import { parsePlayerSocialLinks, type Player, type PlayerMusicConnection } from "@/lib/players-data";

function publicHttpUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function buildPlayerSameAs(player: Player, musicConnections: PlayerMusicConnection[]) {
  const candidates = [
    ...parsePlayerSocialLinks(player.social_links).map((link) => link.url),
    player.spotify_profile_url,
    player.youtube_channel_url,
    ...musicConnections.map((connection) => connection.external_url),
  ];

  return [...new Set(candidates.map(publicHttpUrl).filter((url): url is string => Boolean(url)))];
}

export function buildPlayerStructuredData({
  player,
  canonicalAlias,
  musicConnections,
}: {
  player: Player;
  canonicalAlias: string;
  musicConnections: PlayerMusicConnection[];
}) {
  const canonical = `https://clouva.com.ar/${canonicalAlias}`;
  const personId = `${canonical}#person`;
  const profileId = `${canonical}#profile`;
  const sameAs = buildPlayerSameAs(player, musicConnections);
  const externalIdentifiers = musicConnections
    .filter((connection) => Boolean(connection.external_artist_id))
    .map((connection) => ({
      "@type": "PropertyValue",
      propertyID: connection.provider,
      value: connection.external_artist_id,
      ...(connection.external_url ? { url: connection.external_url } : {}),
    }));
  const image = player.profile_image_url || player.og_image_url || player.cover_url || undefined;
  const description = player.seo_description || player.long_bio || player.short_bio || player.tagline || undefined;
  const alternateName = (player.alternate_names || []).filter(Boolean);
  const knowsAbout = [...new Set([...(player.genres || []), ...(player.disciplines || []), ...(player.professional_categories || [])].filter(Boolean))];
  const disambiguatingDescription = [player.public_identity_label, player.origin, player.country].filter(Boolean).join(" · ") || undefined;

  const person: Record<string, unknown> = {
    "@type": "Person",
    "@id": personId,
    name: player.display_name,
    url: canonical,
    mainEntityOfPage: { "@id": profileId },
  };

  if (alternateName.length) person.alternateName = alternateName;
  if (description) person.description = description;
  if (disambiguatingDescription) person.disambiguatingDescription = disambiguatingDescription;
  if (image) person.image = image;
  if (player.schema_job_title || player.primary_role) {
    person.jobTitle = player.schema_job_title || player.primary_role;
    person.hasOccupation = { "@type": "Occupation", name: player.schema_job_title || player.primary_role };
  }
  if (player.country) person.nationality = { "@type": "Country", name: player.country };
  if (player.birth_place) person.birthPlace = { "@type": "Place", name: player.birth_place };
  if (player.location) person.homeLocation = { "@type": "Place", name: player.location };
  if (knowsAbout.length) person.knowsAbout = knowsAbout;
  if (sameAs.length) person.sameAs = sameAs;
  if (externalIdentifiers.length) person.identifier = externalIdentifiers;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ProfilePage",
        "@id": profileId,
        url: canonical,
        name: player.seo_title || `${player.display_name} — Perfil oficial`,
        ...(description ? { description } : {}),
        ...(image ? { primaryImageOfPage: { "@type": "ImageObject", url: image } } : {}),
        mainEntity: { "@id": personId },
      },
      person,
    ],
  };
}
