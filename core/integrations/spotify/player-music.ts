import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormalizedArtist } from "./types";

export async function canManagePlayerMusic(admin: SupabaseClient, userId: string, playerId: string) {
  const [playerResult, memberResult, profileResult] = await Promise.all([
    admin.from("players").select("owner_user_id").eq("id", playerId).maybeSingle(),
    admin.from("player_members").select("id").eq("player_id", playerId).eq("user_id", userId).eq("status", "active").in("role", ["owner", "manager", "editor"]).maybeSingle(),
    admin.from("profiles").select("role").eq("id", userId).maybeSingle(),
  ]);
  if (playerResult.error) throw new Error(playerResult.error.message);
  if (memberResult.error) throw new Error(memberResult.error.message);
  if (profileResult.error) throw new Error(profileResult.error.message);
  return playerResult.data?.owner_user_id === userId || Boolean(memberResult.data) || profileResult.data?.role === "admin";
}

export async function requirePlayerMusicManager(admin: SupabaseClient, userId: string, playerId: string) {
  if (!playerId || !(await canManagePlayerMusic(admin, userId, playerId))) {
    const error = new Error("No autorizado para administrar este Player.");
    error.name = "PlayerMusicForbidden";
    throw error;
  }
}

export async function upsertPlayerSpotifyArtist(admin: SupabaseClient, playerId: string, artist: NormalizedArtist) {
  const now = new Date().toISOString();
  const { data, error } = await admin.from("player_music_connections").upsert({
    player_id: playerId,
    provider: "spotify",
    connection_type: "artist",
    external_artist_id: artist.id,
    external_uri: artist.uri,
    external_url: artist.externalUrl,
    artist_name: artist.name,
    artist_image_url: artist.imageUrl,
    verification_status: "unverified",
    metadata: {},
    updated_at: now,
  }, { onConflict: "player_id,provider,connection_type" }).select("id,player_id,provider,external_artist_id,external_uri,external_url,artist_name,artist_image_url,verification_status,last_synced_at").single();
  if (error) throw new Error(`No se pudo vincular Spotify Artist: ${error.message}`);
  const { error: legacyError } = await admin.from("players").update({
    spotify_artist_id: artist.id,
    spotify_profile_url: artist.externalUrl,
    spotify_sync_status: "pending",
    spotify_sync_error: null,
  }).eq("id", playerId);
  if (legacyError) throw new Error(`No se pudo actualizar la compatibilidad Spotify del Player: ${legacyError.message}`);
  return data;
}

export async function unlinkPlayerSpotifyArtist(admin: SupabaseClient, playerId: string) {
  const { error: tracksError } = await admin.from("external_music_tracks").delete().eq("player_id", playerId).eq("provider", "spotify");
  if (tracksError) throw new Error(tracksError.message);
  const { error } = await admin.from("player_music_connections").delete().eq("player_id", playerId).eq("provider", "spotify");
  if (error) throw new Error(error.message);
  await admin.from("players").update({
    spotify_artist_id: null,
    spotify_profile_url: null,
    spotify_last_sync_at: null,
    spotify_sync_status: null,
    spotify_sync_error: null,
  }).eq("id", playerId);
}
