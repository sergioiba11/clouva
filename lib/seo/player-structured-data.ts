import { parsePlayerSocialLinks, type Player, type PlayerMusicConnection } from "@/lib/players-data";

const CLOUVA_ARTIST_ALIAS = "clouva";
const CLOUVA_SPOTIFY_URL = "https://open.spotify.com/artist/4ZcY2ix70hKrXgP6QlnZhT";
const CLOUVA_YOUTUBE_URL = "https://www.youtube.com/@clouvanlb";

function publicHttpUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

export function buildPlayerSameAs(player: Player, musicConnections: PlayerMusicConnection[]) {
  const isClouva = player.slug.toLowerCase() === CLOUVA_ARTIST_ALIAS;
  const candidates = [
    ...parsePlayerSocialLinks(player.social_links).map((link) => link.url),
    player.spotify_profile_url,
    player.youtube_channel_url,
    ...musicConnections.map((connection) => connection.external_url),
    ...(isClouva ? [CLOUVA_SPOTIFY_URL, CLOUVA_YOUTUBE_URL] : []),
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
  const isClouva = canonicalAlias.toLowerCase() === CLOUVA_ARTIST_ALIAS;
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
  const description =
    player.seo_description ||
    player.long_bio ||
    player.short_bio ||
    player.tagline ||
    (isClouva
      ? "CLOUVA es un artista argentino de Zapala, Neuquén, también conocido como Clover."
      : undefined);
  const alternateName = uniqueStrings([
    ...(player.alternate_names || []),
    ...(isClouva ? ["CLOUVA", "Clouva", "Clover", "Clover.nlb"] : []),
  ]);
  const knowsAbout = uniqueStrings([
    ...(player.genres || []),
    ...(player.disciplines || []),
    ...(player.professional_categories || []),
    ...(isClouva ? ["Música", "Rap", "Hip hop", "Identidad visual"] : []),
  ]);
  const disambiguatingDescription = isClouva
    ? "Artista argentino de Zapala, Neuquén · también conocido como Clover"
    : [player.public_identity_label, player.origin, player.country].filter(Boolean).join(" · ") || undefined;

  const person: Record<string, unknown> = {
    "@type": "Person",
    "@id": personId,
    name: isClouva ? "CLOUVA" : player.display_name,
    url: canonical,
    mainEntityOfPage: { "@id": profileId },
  };

  if (alternateName.length) person.alternateName = alternateName;
  if (isClouva) person.additionalName = "Clover";
  if (description) person.description = description;
  if (disambiguatingDescription) person.disambiguatingDescription = disambiguatingDescription;
  if (image) person.image = image;

  const occupation = isClouva ? "Artista musical argentino" : player.schema_job_title || player.primary_role;
  if (occupation) {
    person.jobTitle = occupation;
    person.hasOccupation = { "@type": "Occupation", name: occupation };
  }

  const country = isClouva ? "Argentina" : player.country;
  if (country) person.nationality = { "@type": "Country", name: country };

  const birthPlace = isClouva ? player.birth_place || "Zapala, Neuquén, Argentina" : player.birth_place;
  if (birthPlace) person.birthPlace = { "@type": "Place", name: birthPlace };

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
        name: isClouva
          ? "CLOUVA — Artista argentino | Perfil oficial"
          : player.seo_title || `${player.display_name} — Perfil oficial`,
        ...(description ? { description } : {}),
        inLanguage: "es-AR",
        ...(image ? { primaryImageOfPage: { "@type": "ImageObject", url: image } } : {}),
        mainEntity: { "@id": personId },
      },
      person,
    ],
  };
}
