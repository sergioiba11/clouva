import "server-only";

import { cache } from "react";
import { IGLU_RADIO_STREAM_URL } from "@/lib/iglu-radio/config";
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
  player_id: string | null;
  space_id: string | null;
  studio_id: string | null;
  station_name: string;
  tagline: string | null;
  stream_url: string | null;
  artwork_url: string | null;
  is_enabled: boolean;
  is_public: boolean;
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

function ownerColumn(ownerKind: RadioOwnerKind) {
  if (ownerKind === "player") return "player_id";
  if (ownerKind === "studio") return "studio_id";
  return "space_id";
}

export const resolvePublicProfileRadio = cache(async (alias: string): Promise<RadioStationConfig | null> => {
  const normalized = alias.trim().toLowerCase();
  if (!normalized) return null;

  const identity = await resolveIdentity(normalized);
  if (!identity) return null;

  const { data, error } = await createPublicSupabase()
    .from("profile_radio_settings")
    .select("id,player_id,space_id,studio_id,station_name,tagline,stream_url,artwork_url,is_enabled,is_public")
    .eq(ownerColumn(identity.ownerKind), identity.ownerId)
    .eq("is_enabled", true)
    .eq("is_public", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as PublicRadioRow;
  const stationName = row.station_name.trim() || identity.name;
  const artworkUrl = row.artwork_url || identity.artworkUrl;
  const isHistoricalIglu = identity.ownerKind === "studio" && identity.canonicalAlias === "el-iglu";
  const streamUrl = row.stream_url?.trim() || (isHistoricalIglu ? IGLU_RADIO_STREAM_URL : "");

  return {
    id: row.id,
    ownerKind: identity.ownerKind,
    ownerId: identity.ownerId,
    alias: identity.canonicalAlias,
    profileHref: `/${identity.canonicalAlias}`,
    name: stationName,
    tagline: row.tagline?.trim() || identity.tagline || null,
    streamUrl,
    artworkUrl,
    enabled: row.is_enabled,
    published: row.is_public,
    metadata: {
      title: stationName,
      artist: "",
      program: "",
      host: null,
      artwork: artworkUrl,
      startedAt: null,
      endsAt: null,
    },
  };
});
