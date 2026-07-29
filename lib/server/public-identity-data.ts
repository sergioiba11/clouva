import { createPublicSupabase } from "./public-supabase";
import {
  playerPublicSelect,
  playerStudiosSelect,
  studioPlayersSelect,
  type Player,
  type PlayerMedia,
  type PlayerStudioAffiliation,
  type StudioPlayer,
  type StudioRow,
} from "@/lib/players-data";

export async function listPublishedPlayers() {
  const { data, error } = await createPublicSupabase()
    .from("players")
    .select(playerPublicSelect)
    .eq("is_published", true)
    .eq("publication_status", "published")
    .neq("privacy_status", "private")
    .order("display_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Player[];
}

export async function resolvePlayerAlias(alias: string) {
  const supabase = createPublicSupabase();
  const normalized = alias.toLowerCase();
  const { data: aliasRow, error: aliasError } = await supabase
    .from("public_slug_aliases")
    .select("alias,entity_id,is_primary,redirect_to_primary")
    .eq("normalized_alias", normalized)
    .eq("entity_type", "player")
    .maybeSingle();
  if (aliasError) throw new Error(aliasError.message);

  let playerQuery = supabase.from("players").select(playerPublicSelect);
  playerQuery = aliasRow
    ? playerQuery.eq("id", aliasRow.entity_id)
    : playerQuery.eq("slug", normalized);
  const { data: player, error: playerError } = await playerQuery
    .eq("is_published", true)
    .eq("publication_status", "published")
    .neq("privacy_status", "private")
    .maybeSingle();
  if (playerError) throw new Error(playerError.message);
  if (!player) return null;

  const [affiliationResult, mediaResult, aliasResult, vipResult] = await Promise.all([
    supabase.from("player_studios").select(playerStudiosSelect).eq("player_id", player.id).eq("is_visible", true).order("display_order"),
    supabase.from("player_media").select("id,media_type,origin,source_url,public_url,thumbnail_url,caption,display_order").eq("player_id", player.id).eq("visibility", "public").order("display_order"),
    supabase.from("public_slug_aliases").select("alias").eq("entity_type", "player").eq("entity_id", player.id).eq("is_primary", true).maybeSingle(),
    supabase.rpc("is_player_vip", { p_player_id: player.id }),
  ]);
  if (affiliationResult.error) throw new Error(affiliationResult.error.message);
  if (mediaResult.error) throw new Error(mediaResult.error.message);

  return {
    player: player as unknown as Player,
    affiliations: (affiliationResult.data ?? []) as unknown as PlayerStudioAffiliation[],
    media: (mediaResult.data ?? []) as unknown as PlayerMedia[],
    canonicalAlias: aliasResult.data?.alias || player.slug,
    isVip: vipResult.data === true,
  };
}

export async function listPublishedStudios() {
  const { data, error } = await createPublicSupabase()
    .from("studios")
    .select("id,slug,name,logo_url,cover_url,description,tagline,categories,city,country,website_url,social_links,contact_email,is_published,publication_status")
    .eq("is_published", true)
    .eq("publication_status", "published")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as StudioRow[];
}

export async function resolveStudioAlias(alias: string) {
  const supabase = createPublicSupabase();
  const normalized = alias.toLowerCase();
  const { data: aliasRow, error: aliasError } = await supabase
    .from("public_slug_aliases")
    .select("alias,entity_id")
    .eq("normalized_alias", normalized)
    .eq("entity_type", "studio")
    .maybeSingle();
  if (aliasError) throw new Error(aliasError.message);

  let query = supabase
    .from("studios")
    .select("id,slug,name,logo_url,cover_url,description,tagline,categories,city,country,website_url,social_links,contact_email,is_published,publication_status");
  query = aliasRow ? query.eq("id", aliasRow.entity_id) : query.eq("slug", normalized);
  const { data: studio, error: studioError } = await query
    .eq("is_published", true)
    .eq("publication_status", "published")
    .maybeSingle();
  if (studioError) throw new Error(studioError.message);
  if (!studio) return null;

  const [playersResult, mediaResult, projectsResult, aliasResult] = await Promise.all([
    supabase.from("player_studios").select(studioPlayersSelect).eq("studio_id", studio.id).eq("is_visible", true).order("display_order"),
    supabase.from("player_media").select("id,media_type,origin,source_url,public_url,thumbnail_url,caption,display_order").eq("studio_id", studio.id).eq("visibility", "public").order("display_order"),
    supabase.from("community_projects").select("id,title,cover_url,release_type,release_date,spotify_url,youtube_url,description").eq("studio_id", studio.id).eq("is_published", true).order("release_date", { ascending: false }),
    supabase.from("public_slug_aliases").select("alias").eq("entity_type", "studio").eq("entity_id", studio.id).eq("is_primary", true).maybeSingle(),
  ]);
  if (playersResult.error) throw new Error(playersResult.error.message);
  if (mediaResult.error) throw new Error(mediaResult.error.message);
  if (projectsResult.error) throw new Error(projectsResult.error.message);

  return {
    studio: studio as unknown as StudioRow,
    players: (playersResult.data ?? []) as unknown as StudioPlayer[],
    media: (mediaResult.data ?? []) as unknown as PlayerMedia[],
    projects: projectsResult.data ?? [],
    canonicalAlias: aliasResult.data?.alias || studio.slug,
  };
}
