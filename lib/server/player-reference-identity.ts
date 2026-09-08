import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  playerPublicSelect,
  playerStudiosSelect,
  type Player,
  type PlayerMedia,
  type PlayerStudioAffiliation,
} from "@/lib/players-data";
import { sanitizeLayoutConfig, type LayoutConfig } from "@/lib/server/layout-config";

export type PlayerIdentityData = {
  player: Player;
  affiliations: PlayerStudioAffiliation[];
  media: PlayerMedia[];
  canonicalAlias: string;
  isVip: boolean;
  layoutConfig: LayoutConfig | null;
};

/**
 * Authorized counterpart of resolvePlayerAlias. The caller already owns or
 * manages the Player, so unpublished drafts can be rendered by the signed
 * Reference Fidelity preview without ever making them public.
 */
export async function resolvePlayerIdentityById(
  admin: SupabaseClient,
  playerId: string,
  layoutOverride?: unknown,
): Promise<PlayerIdentityData | null> {
  const { data: player, error: playerError } = await admin
    .from("players")
    .select(playerPublicSelect)
    .eq("id", playerId)
    .maybeSingle();
  if (playerError) throw new Error(playerError.message);
  if (!player) return null;

  const [affiliationResult, mediaResult, aliasResult, vipResult, publishedResult] = await Promise.all([
    admin.from("player_studios").select(playerStudiosSelect).eq("player_id", playerId).eq("is_visible", true).eq("status", "active").order("display_order"),
    admin.from("player_media").select("id,media_type,origin,source_url,public_url,thumbnail_url,caption,display_order").eq("player_id", playerId).eq("visibility", "public").order("display_order"),
    admin.from("public_slug_aliases").select("alias").eq("entity_type", "player").eq("entity_id", playerId).eq("is_primary", true).maybeSingle(),
    admin.rpc("is_player_vip", { p_player_id: playerId }),
    admin.from("player_profile_versions").select("layout_config").eq("player_id", playerId).eq("status", "published").maybeSingle(),
  ]);
  if (affiliationResult.error) throw new Error(affiliationResult.error.message);
  if (mediaResult.error) throw new Error(mediaResult.error.message);

  const layoutConfig = layoutOverride !== undefined
    ? sanitizeLayoutConfig(layoutOverride)
    : publishedResult.error ? null : sanitizeLayoutConfig(publishedResult.data?.layout_config);

  return {
    player: player as unknown as Player,
    affiliations: (affiliationResult.data ?? []) as unknown as PlayerStudioAffiliation[],
    media: (mediaResult.data ?? []) as unknown as PlayerMedia[],
    canonicalAlias: aliasResult.data?.alias || (player as unknown as Player).slug,
    isVip: vipResult.data === true,
    layoutConfig,
  };
}
