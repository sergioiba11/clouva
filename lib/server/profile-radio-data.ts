import "server-only";

import { cache } from "react";
import type { RadioOwnerKind, RadioStationConfig } from "@/lib/radio/types";
import { resolvePlayerAlias, resolveStudioAlias } from "@/lib/server/public-identity-data";
import { resolvePublicSpaceAlias } from "@/lib/server/public-space-data";
import { createPublicSupabase } from "@/lib/server/public-supabase";

type RadioIdentity = {
  ownerKind: RadioOwnerKind;
  ownerId: string;
  canonicalAlias: string;
  name: string;
  tagline: string | null;
  artworkUrl: string | null;
};

type PublicRadioRow = {
  id: string;
  profile_type: RadioOwnerKind;
  profile_id: string;
  station_slug: string;
  station_name: string | null;
  tagline: string | null;
  cover_url: string | null;
  artwork_url: string | null;
  stream_url: string | null;
  is_enabled: boolean;
  is_public: boolean;
  now_playing_title: string | null;
  now_playing_artist: string | null;
  now_playing_program: string | null;
  now_playing_host: string | null;
  now_playing_artwork: string | null;
  now_playing_started_at: string | null;
  now_playing_ends_at: string | null;
};

async function resolveIdentity(alias: string): Promise<RadioIdentity | null> {
  const player = await resolvePlayerAlias(alias);
  if (player) {
    return {
      ownerKind: "player",
      ownerId: player.player.id,
      canonicalAlias: player.canonicalAlias,
      name: player.player.display_name,
      tagline: player.player.tagline,
      artworkUrl: player.player.logo_url || player.player.profile_image_url || player.player.cover_url,
    };
  }

  const studio = await resolveStudioAlias(alias);
  if (studio) {
    return {
      ownerKind: "studio",
      ownerId: studio.studio.id,
      canonicalAlias: studio.canonicalAlias,
      name: studio.studio.name,
      tagline: studio.studio.tagline,
      artworkUrl: studio.studio.logo_url || studio.studio.cover_url,
    };
  }

  const space = await resolvePublicSpaceAlias(alias);
  if (space) {
    return {
      ownerKind: "space",
      ownerId: space.space.id,
      canonicalAlias: space.canonicalAlias,
      name: space.space.name,
      tagline: space.space.description,
      artworkUrl: space.space.logo_url || space.space.cover_url,
    };
  }

  return null;
}

export const resolvePublicProfileRadio = cache(async (alias: string): Promise<RadioStationConfig | null> => {
  const normalized = alias.trim().toLowerCase();
  if (!normalized) return null;

  const identity = await resolveIdentity(normalized);
  if (!identity) return null;

  const { data, error } = await createPublicSupabase()
    .from("profile_radio_settings")
    .select("id,profile_type,profile_id,station_slug,station_name,tagline,cover_url,artwork_url,stream_url,is_enabled,is_public,now_playing_title,now_playing_artist,now_playing_program,now_playing_host,now_playing_artwork,now_playing_started_at,now_playing_ends_at")
    .eq("profile_type", identity.ownerKind)
    .eq("profile_id", identity.ownerId)
    .eq("is_enabled", true)
    .eq("is_public", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as PublicRadioRow;
  const stationName = row.station_name?.trim() || identity.name;

  return {
    id: row.id,
    ownerKind: identity.ownerKind,
    ownerId: identity.ownerId,
    alias: identity.canonicalAlias,
    profileHref: `/${identity.canonicalAlias}`,
    name: stationName,
    tagline: row.tagline?.trim() || identity.tagline || null,
    streamUrl: row.stream_url?.trim() || "",
    artworkUrl: row.artwork_url || row.cover_url || identity.artworkUrl,
    enabled: row.is_enabled,
    published: row.is_public,
    metadata: {
      title: row.now_playing_title?.trim() || stationName,
      artist: row.now_playing_artist?.trim() || identity.name,
      program: row.now_playing_program?.trim() || "Señal principal",
      host: row.now_playing_host,
      artwork: row.now_playing_artwork || row.artwork_url || row.cover_url || identity.artworkUrl,
      startedAt: row.now_playing_started_at,
      endsAt: row.now_playing_ends_at,
    },
  };
});
