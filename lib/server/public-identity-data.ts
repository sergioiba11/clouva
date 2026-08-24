import { createPublicSupabase } from "./public-supabase";
import { sanitizeLayoutConfig, type LayoutConfig } from "./layout-config";
import {
  playerPublicSelect,
  playerStudiosSelect,
  studioMembershipPlansSelect,
  studioPlayersSelect,
  studioServicesSelect,
  type ExternalMusicTrack,
  type Player,
  type PlayerMedia,
  type PlayerMusicConnection,
  type PlayerStudioAffiliation,
  type StudioMembershipPlan,
  type StudioPlayer,
  type StudioRow,
  type StudioService,
} from "@/lib/players-data";

const studioPublicSelect =
  "id,slug,name,logo_url,cover_url,description,short_bio,tagline,categories,city,country,website_url,social_links,contact_email,is_published,publication_status,studio_os_status,seo_title,seo_description,share_title,share_description,og_image_url,accent_color,palette";

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
  playerQuery = aliasRow ? playerQuery.eq("id", aliasRow.entity_id) : playerQuery.eq("slug", normalized);
  const { data: player, error: playerError } = await playerQuery
    .eq("is_published", true)
    .eq("publication_status", "published")
    .neq("privacy_status", "private")
    .maybeSingle();
  if (playerError) throw new Error(playerError.message);
  if (!player) return null;

  const [affiliationResult, mediaResult, aliasResult, vipResult, musicConnectionResult, musicTracksResult] = await Promise.all([
    supabase.from("player_studios").select(playerStudiosSelect).eq("player_id", player.id).eq("is_visible", true).eq("status", "active").order("display_order"),
    supabase.from("player_media").select("id,media_type,origin,source_url,public_url,thumbnail_url,caption,display_order").eq("player_id", player.id).eq("visibility", "public").order("display_order"),
    supabase.from("public_slug_aliases").select("alias").eq("entity_type", "player").eq("entity_id", player.id).eq("is_primary", true).maybeSingle(),
    supabase.rpc("is_player_vip", { p_player_id: player.id }),
    supabase.from("player_music_connections").select("id,player_id,provider,external_artist_id,external_uri,external_url,artist_name,artist_image_url,verification_status,last_synced_at").eq("player_id", player.id).eq("provider", "spotify").maybeSingle(),
    supabase.from("external_music_tracks").select("id,player_id,provider,external_track_id,external_track_uri,external_album_id,title,artist_name,album_name,cover_url,external_url,release_date,last_synced_at").eq("player_id", player.id).eq("provider", "spotify").order("release_date", { ascending: false }).limit(12),
  ]);
  if (affiliationResult.error) throw new Error(affiliationResult.error.message);
  if (mediaResult.error) throw new Error(mediaResult.error.message);

  return {
    player: player as unknown as Player,
    affiliations: (affiliationResult.data ?? []) as unknown as PlayerStudioAffiliation[],
    media: (mediaResult.data ?? []) as unknown as PlayerMedia[],
    musicConnection: musicConnectionResult.error ? null : musicConnectionResult.data as unknown as PlayerMusicConnection | null,
    musicTracks: musicTracksResult.error ? [] : (musicTracksResult.data ?? []) as unknown as ExternalMusicTrack[],
    canonicalAlias: aliasResult.data?.alias || player.slug,
    isVip: vipResult.data === true,
  };
}

export async function listPublishedStudios() {
  const { data, error } = await createPublicSupabase()
    .from("studios")
    .select(studioPublicSelect)
    .eq("is_published", true)
    .eq("publication_status", "published")
    .in("studio_os_status", ["active", "grace", "legacy_active"])
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

  let query = supabase.from("studios").select(studioPublicSelect);
  query = aliasRow ? query.eq("id", aliasRow.entity_id) : query.eq("slug", normalized);
  const { data: studio, error: studioError } = await query
    .eq("is_published", true)
    .eq("publication_status", "published")
    .in("studio_os_status", ["active", "grace", "legacy_active"])
    .maybeSingle();
  if (studioError) throw new Error(studioError.message);
  if (!studio) return null;

  const [playersResult, mediaResult, projectsResult, servicesResult, membershipPlansResult, aliasResult, versionResult] = await Promise.all([
    supabase.from("player_studios").select(studioPlayersSelect).eq("studio_id", studio.id).eq("is_visible", true).eq("status", "active").order("display_order"),
    supabase.from("player_media").select("id,media_type,origin,source_url,public_url,thumbnail_url,caption,display_order").eq("studio_id", studio.id).eq("visibility", "public").order("display_order"),
    supabase.from("community_projects").select("id,title,cover_url,release_type,release_date,spotify_url,youtube_url,description").eq("studio_id", studio.id).order("release_date", { ascending: false }),
    supabase.from("studio_services").select(studioServicesSelect).eq("studio_id", studio.id).eq("is_active", true).order("display_order"),
    supabase.from("studio_membership_plans").select(studioMembershipPlansSelect).eq("studio_id", studio.id).eq("is_active", true).eq("is_public", true).order("display_order"),
    supabase.from("public_slug_aliases").select("alias").eq("entity_type", "studio").eq("entity_id", studio.id).eq("is_primary", true).maybeSingle(),
    supabase.from("player_profile_versions").select("layout_config").eq("studio_id", studio.id).eq("status", "published").maybeSingle(),
  ]);
  if (playersResult.error) throw new Error(playersResult.error.message);
  if (mediaResult.error) throw new Error(mediaResult.error.message);
  if (projectsResult.error) throw new Error(projectsResult.error.message);
  if (servicesResult.error) throw new Error(servicesResult.error.message);
  if (membershipPlansResult.error) throw new Error(membershipPlansResult.error.message);

  const layoutConfig: LayoutConfig | null = versionResult.error
    ? null
    : sanitizeLayoutConfig(versionResult.data?.layout_config);

  const studioPlayers = (playersResult.data ?? []) as unknown as StudioPlayer[];
  const playerIds = studioPlayers.map((entry) => entry.player?.id).filter((id): id is string => Boolean(id));
  const musicResult = playerIds.length
    ? await supabase
        .from("external_music_tracks")
        .select("id,player_id,title,artist_name,cover_url,external_url,release_date")
        .in("player_id", playerIds)
        .eq("provider", "spotify")
        .order("release_date", { ascending: false })
        .limit(18)
    : { data: [], error: null };

  const baseProjects = projectsResult.data ?? [];
  const knownSpotifyUrls = new Set(baseProjects.map((project) => project.spotify_url).filter(Boolean));
  const spotifyProjects = (musicResult.data ?? [])
    .filter((track) => track.external_url && !knownSpotifyUrls.has(track.external_url))
    .map((track) => ({
      id: `spotify-${track.id}`,
      title: track.title,
      cover_url: track.cover_url,
      release_type: "spotify",
      release_date: track.release_date,
      spotify_url: track.external_url,
      youtube_url: null,
      description: track.artist_name,
    }));
  const projects = [...baseProjects, ...spotifyProjects]
    .sort((a, b) => String(b.release_date || "").localeCompare(String(a.release_date || "")));

  const matrixDiscoveryProjects = projects.length === 0
    ? await (async () => {
        const { data, error } = await supabase
          .from("community_projects")
          .select("id,title,cover_url,spotify_url,youtube_url,studio:studios(name,slug)")
          .neq("studio_id", studio.id)
          .or("spotify_url.not.is.null,youtube_url.not.is.null")
          .order("release_date", { ascending: false })
          .limit(6);
        if (error) return [];
        return data ?? [];
      })()
    : [];

  return {
    studio: studio as unknown as StudioRow,
    players: studioPlayers,
    media: (mediaResult.data ?? []) as unknown as PlayerMedia[],
    projects,
    matrixDiscoveryProjects,
    services: (servicesResult.data ?? []) as unknown as StudioService[],
    membershipPlans: (membershipPlansResult.data ?? []) as unknown as StudioMembershipPlan[],
    canonicalAlias: aliasResult.data?.alias || studio.slug,
    layoutConfig,
  };
}
