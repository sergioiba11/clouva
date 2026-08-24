import type { SupabaseClient } from "@supabase/supabase-js";
import { getSpotifyAppAccessToken, spotifyApiFetch } from "./client";
import type { NormalizedArtist, NormalizedMusicTrack } from "./types";

type SpotifyArtistObject = {
  id: string;
  uri: string;
  name: string;
  external_urls?: { spotify?: string };
  images?: Array<{ url: string }>;
};

type SpotifyAlbum = {
  id: string;
  name: string;
  release_date?: string;
  external_urls?: { spotify?: string };
  images?: Array<{ url: string }>;
  artists?: Array<{ id: string; name: string }>;
};

type SpotifyTrack = {
  id: string;
  uri: string;
  name: string;
  external_urls?: { spotify?: string };
  artists?: Array<{ id: string; name: string }>;
};

async function appApi<T>(path: string) {
  const token = await getSpotifyAppAccessToken();
  return spotifyApiFetch<T>({ accessToken: token.access_token, path });
}

export async function getSpotifyArtist(artistId: string): Promise<NormalizedArtist> {
  const artist = await appApi<SpotifyArtistObject>(`/artists/${encodeURIComponent(artistId)}`);
  return {
    provider: "spotify",
    id: artist.id,
    uri: artist.uri || `spotify:artist:${artist.id}`,
    name: artist.name,
    externalUrl: artist.external_urls?.spotify || `https://open.spotify.com/artist/${artist.id}`,
    imageUrl: artist.images?.[0]?.url || null,
  };
}

export function extractSpotifyArtistId(value: string) {
  const candidate = value.trim();
  const uri = candidate.match(/^spotify:artist:([A-Za-z0-9]+)$/i);
  if (uri) return uri[1];
  try {
    const url = new URL(candidate);
    if (url.hostname === "open.spotify.com" || url.hostname.endsWith(".spotify.com")) {
      const match = url.pathname.match(/^\/artist\/([A-Za-z0-9]+)/);
      if (match) return match[1];
    }
  } catch {
    // Not a URL; continue with ID/name detection.
  }
  if (/^[A-Za-z0-9]{16,32}$/.test(candidate)) return candidate;
  return null;
}

export async function resolveSpotifyArtist(value: string): Promise<NormalizedArtist> {
  const id = extractSpotifyArtistId(value);
  if (id) return getSpotifyArtist(id);
  const search = await appApi<{ artists?: { items?: SpotifyArtistObject[] } }>(
    `/search?q=${encodeURIComponent(value.trim())}&type=artist&limit=5`,
  );
  const first = search.artists?.items?.[0];
  if (!first) throw new Error("No encontramos ese artista en Spotify.");
  return {
    provider: "spotify",
    id: first.id,
    uri: first.uri || `spotify:artist:${first.id}`,
    name: first.name,
    externalUrl: first.external_urls?.spotify || `https://open.spotify.com/artist/${first.id}`,
    imageUrl: first.images?.[0]?.url || null,
  };
}

export async function getSpotifyArtistReleases(artistId: string, artistName: string): Promise<NormalizedMusicTrack[]> {
  const token = await getSpotifyAppAccessToken();
  const albumsResponse = await spotifyApiFetch<{ items?: SpotifyAlbum[] }>({
    accessToken: token.access_token,
    path: `/artists/${encodeURIComponent(artistId)}/albums?include_groups=album,single&limit=10`,
  });
  const albums = albumsResponse.items || [];
  const tracks: NormalizedMusicTrack[] = [];
  const seen = new Set<string>();

  for (const album of albums.slice(0, 10)) {
    const response = await spotifyApiFetch<{ items?: SpotifyTrack[] }>({
      accessToken: token.access_token,
      path: `/albums/${encodeURIComponent(album.id)}/tracks?limit=50`,
    });
    for (const track of response.items || []) {
      if (!track.id || seen.has(track.id)) continue;
      const artistMatch = track.artists?.some((entry) => entry.id === artistId);
      if (!artistMatch && track.artists?.length) continue;
      seen.add(track.id);
      tracks.push({
        provider: "spotify",
        id: track.id,
        uri: track.uri || `spotify:track:${track.id}`,
        albumId: album.id,
        title: track.name,
        artist: track.artists?.map((entry) => entry.name).join(", ") || artistName,
        album: album.name || null,
        coverUrl: album.images?.[0]?.url || null,
        externalUrl: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
        releaseDate: album.release_date || null,
      });
    }
  }
  return tracks.sort((a, b) => String(b.releaseDate || "").localeCompare(String(a.releaseDate || "")));
}

export async function syncSpotifyPlayerCatalog(options: {
  admin: SupabaseClient;
  playerId: string;
  artist: NormalizedArtist;
}) {
  const tracks = await getSpotifyArtistReleases(options.artist.id, options.artist.name);
  const now = new Date().toISOString();
  if (tracks.length) {
    const rows = tracks.map((track) => ({
      player_id: options.playerId,
      provider: "spotify",
      external_track_id: track.id,
      external_track_uri: track.uri,
      external_album_id: track.albumId,
      title: track.title,
      artist_name: track.artist,
      album_name: track.album,
      cover_url: track.coverUrl,
      external_url: track.externalUrl,
      release_date: track.releaseDate,
      metadata: {},
      last_synced_at: now,
      updated_at: now,
    }));
    const { error } = await options.admin
      .from("external_music_tracks")
      .upsert(rows, { onConflict: "provider,external_track_id,player_id" });
    if (error) throw new Error(`No se pudo sincronizar el catálogo: ${error.message}`);
  }
  const { error: connectionError } = await options.admin
    .from("player_music_connections")
    .update({ last_synced_at: now, updated_at: now })
    .eq("player_id", options.playerId)
    .eq("provider", "spotify");
  if (connectionError) throw new Error(`No se pudo registrar la sincronización: ${connectionError.message}`);
  await options.admin.from("players").update({
    spotify_artist_id: options.artist.id,
    spotify_profile_url: options.artist.externalUrl,
    spotify_last_sync_at: now,
    spotify_sync_status: "ok",
    spotify_sync_error: null,
  }).eq("id", options.playerId);
  return tracks;
}
