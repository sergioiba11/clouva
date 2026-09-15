import { resolvePlayerAlias } from "@/lib/server/public-identity-data";
import { createAdminSupabase } from "@/lib/server/supabase";
import type { RadioOwnerKind, RadioStationConfig } from "@/lib/radio/types";

const RADIO_COLUMNS = "id,player_id,space_id,studio_id,source_studio_id,station_name,tagline,stream_url,artwork_url,is_enabled,is_public";

type RadioRow = {
  id: string;
  player_id: string | null;
  space_id: string | null;
  studio_id: string | null;
  source_studio_id: string | null;
  station_name: string;
  tagline: string | null;
  stream_url: string | null;
  artwork_url: string | null;
  is_enabled: boolean;
  is_public: boolean;
};

type Identity = {
  ownerKind: RadioOwnerKind;
  ownerId: string;
  alias: string;
  profileHref: string;
  displayName: string;
  artworkUrl: string | null;
};

async function getStationForOwner(column: "player_id" | "space_id" | "studio_id", ownerId: string, publicOnly = true) {
  const admin = createAdminSupabase();
  let query = admin.from("profile_radio_settings").select(RADIO_COLUMNS).eq(column, ownerId);
  if (publicOnly) query = query.eq("is_enabled", true).eq("is_public", true);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return (data as RadioRow | null) ?? null;
}

function stationConfig(row: RadioRow, identity: Identity, streamFallback = ""): RadioStationConfig {
  const streamUrl = row.stream_url?.trim() || streamFallback.trim();
  const artworkUrl = row.artwork_url || identity.artworkUrl;
  return {
    id: row.id,
    ownerKind: identity.ownerKind,
    ownerId: identity.ownerId,
    alias: identity.alias,
    profileHref: identity.profileHref,
    name: row.station_name,
    tagline: row.tagline,
    streamUrl,
    artworkUrl,
    enabled: row.is_enabled,
    published: row.is_public,
    metadata: {
      title: row.station_name,
      artist: identity.displayName,
      program: "Señal principal",
      host: null,
      artwork: artworkUrl,
      startedAt: null,
      endsAt: null,
    },
  };
}

export async function resolvePublicRadioAlias(alias: string): Promise<RadioStationConfig | null> {
  const normalized = alias.trim().toLowerCase();
  if (!normalized) return null;

  const playerResult = await resolvePlayerAlias(normalized).catch(() => null);
  if (playerResult) {
    const row = await getStationForOwner("player_id", playerResult.player.id);
    if (!row) return null;
    return stationConfig(row, {
      ownerKind: "player",
      ownerId: playerResult.player.id,
      alias: playerResult.canonicalAlias,
      profileHref: `/${playerResult.canonicalAlias}`,
      displayName: playerResult.player.display_name,
      artworkUrl: playerResult.player.profile_image_url || playerResult.player.cover_url || null,
    });
  }

  const admin = createAdminSupabase();
  const { data: rawSpace, error: spaceError } = await admin
    .from("spaces")
    .select("id,type,slug,name,logo_url,cover_url,legacy_studio_id")
    .eq("slug", normalized)
    .eq("public_enabled", true)
    .eq("status", "active")
    .maybeSingle();
  if (spaceError) throw new Error(spaceError.message);

  if (rawSpace) {
    let row = await getStationForOwner("space_id", rawSpace.id);
    if (!row && rawSpace.legacy_studio_id) row = await getStationForOwner("studio_id", rawSpace.legacy_studio_id);
    if (!row) return null;
    return stationConfig(row, {
      ownerKind: row.space_id ? "space" : "studio",
      ownerId: row.space_id || rawSpace.legacy_studio_id || rawSpace.id,
      alias: rawSpace.slug,
      profileHref: `/${rawSpace.slug}`,
      displayName: rawSpace.name,
      artworkUrl: rawSpace.logo_url || rawSpace.cover_url || null,
    });
  }

  const { data: studio, error: studioError } = await admin
    .from("studios")
    .select("id,slug,name,avatar_url,cover_url")
    .eq("slug", normalized)
    .eq("is_published", true)
    .eq("publication_status", "published")
    .maybeSingle();
  if (studioError) throw new Error(studioError.message);
  if (!studio) return null;

  const row = await getStationForOwner("studio_id", studio.id);
  if (!row) return null;
  return stationConfig(row, {
    ownerKind: "studio",
    ownerId: studio.id,
    alias: studio.slug,
    profileHref: `/${studio.slug}`,
    displayName: studio.name,
    artworkUrl: studio.avatar_url || studio.cover_url || null,
  });
}

export async function loadIgluRadioStation(): Promise<RadioStationConfig> {
  const admin = createAdminSupabase();
  const { data: studio, error: studioError } = await admin
    .from("studios")
    .select("id,slug,name,avatar_url,cover_url")
    .eq("slug", "el-iglu")
    .maybeSingle();
  if (studioError) throw new Error(studioError.message);

  const fallbackStream = process.env.NEXT_PUBLIC_IGLU_RADIO_STREAM_URL?.trim() ?? "";
  if (studio) {
    const row = await getStationForOwner("studio_id", studio.id, false);
    if (row) {
      return stationConfig(row, {
        ownerKind: "studio",
        ownerId: studio.id,
        alias: "iglu",
        profileHref: "/el-iglu",
        displayName: "IGLÚ RECORDS",
        artworkUrl: studio.avatar_url || studio.cover_url || null,
      }, fallbackStream);
    }
  }

  return {
    id: "iglu-legacy",
    ownerKind: "studio",
    ownerId: studio?.id ?? "iglu",
    alias: "iglu",
    profileHref: "/el-iglu",
    name: "IGLÚ RADIO",
    tagline: "DEL SUR PARA EL MUNDO",
    streamUrl: fallbackStream,
    artworkUrl: studio?.avatar_url || studio?.cover_url || null,
    enabled: true,
    published: true,
    metadata: {
      title: "IGLÚ RADIO",
      artist: "IGLÚ RECORDS",
      program: "Señal principal",
      host: null,
      artwork: studio?.avatar_url || studio?.cover_url || null,
      startedAt: null,
      endsAt: null,
    },
  };
}
