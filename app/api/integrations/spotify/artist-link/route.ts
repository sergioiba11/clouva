import { NextRequest, NextResponse } from "next/server";
import { getSpotifyAppAccessToken, SpotifyApiError, spotifyApiFetch } from "@/core/integrations/spotify/client";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

type SpotifyArtist = {
  id: string;
  name: string;
  uri: string;
  external_urls?: { spotify?: string };
  images?: Array<{ url: string; width?: number | null; height?: number | null }>;
  genres?: string[];
};

type SpotifyArtistSearch = {
  artists?: {
    items?: SpotifyArtist[];
    total?: number;
    offset?: number;
    limit?: number;
  };
};

type SpotifyTrack = {
  id: string;
  name: string;
  artists?: SpotifyArtist[];
  external_urls?: { spotify?: string };
};

type SpotifyTrackSearch = {
  tracks?: {
    items?: SpotifyTrack[];
    total?: number;
    offset?: number;
    limit?: number;
  };
};

type SpotifyAlbum = {
  id: string;
  name: string;
  album_type?: string;
  release_date?: string;
  total_tracks?: number;
  external_urls?: { spotify?: string };
  images?: Array<{ url: string; width?: number | null; height?: number | null }>;
};

type SpotifyAlbumPage = {
  items?: SpotifyAlbum[];
};

type SpotifyOEmbed = {
  title?: string;
  html?: string;
  provider_name?: string;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
};

type SpotifyReference = {
  id: string;
  kind: "catalog_artist" | "for_artists_workspace";
  url: string;
};

const SPOTIFY_ID_RE = /^[A-Za-z0-9]{10,64}$/;

function parseSpotifyReference(value: unknown, forcedKind?: SpotifyReference["kind"]): SpotifyReference | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (!input) return null;

  const uriMatch = input.match(/^spotify:artist:([A-Za-z0-9]{10,64})$/i);
  if (uriMatch) {
    return {
      id: uriMatch[1],
      kind: forcedKind || "catalog_artist",
      url: forcedKind === "for_artists_workspace"
        ? `https://artists.spotify.com/c/artist/${uriMatch[1]}/home`
        : `https://open.spotify.com/artist/${uriMatch[1]}`,
    };
  }

  try {
    const url = new URL(input);
    const parts = url.pathname.split("/").filter(Boolean);
    const artistIndex = parts.findIndex((part) => part.toLowerCase() === "artist");
    const id = artistIndex >= 0 ? parts[artistIndex + 1] : null;
    if (!id || !SPOTIFY_ID_RE.test(id)) return null;

    if (/^artists\.spotify\.com$/i.test(url.hostname)) {
      return { id, kind: "for_artists_workspace", url: `https://artists.spotify.com/c/artist/${id}/home` };
    }
    if (/^(?:open\.)?spotify\.com$/i.test(url.hostname)) {
      const kind = forcedKind || "catalog_artist";
      return {
        id,
        kind,
        url: kind === "for_artists_workspace"
          ? `https://artists.spotify.com/c/artist/${id}/home`
          : `https://open.spotify.com/artist/${id}`,
      };
    }
    return null;
  } catch {
    if (!SPOTIFY_ID_RE.test(input)) return null;
    const kind = forcedKind || "catalog_artist";
    return {
      id: input,
      kind,
      url: kind === "for_artists_workspace"
        ? `https://artists.spotify.com/c/artist/${input}/home`
        : `https://open.spotify.com/artist/${input}`,
    };
  }
}

async function ownedPlayer(userId: string) {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("players")
    .select([
      "id,slug,display_name,spotify_artist_id,spotify_profile_url,spotify_sync_status,spotify_last_sync_at,spotify_sync_error",
      "spotify_for_artists_id,spotify_for_artists_url,spotify_for_artists_status,spotify_artist_data,spotify_artist_data_updated_at,spotify_for_artists_last_import_at",
    ].join(","))
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function apiError(error: unknown) {
  if (isAuthError(error)) return NextResponse.json({ error: "Sesión requerida." }, { status: 401 });
  if (error instanceof SpotifyApiError) {
    const status = error.status === 404 ? 404 : error.status === 429 ? 429 : 502;
    const message = status === 404
      ? "No encontramos ese perfil público de artista en el catálogo de Spotify."
      : status === 429
        ? "Spotify está limitando solicitudes. Probá de nuevo en un momento."
        : "Spotify no pudo consultar el catálogo de artistas.";
    return NextResponse.json({ error: message, code: status === 404 ? "spotify_catalog_artist_not_found" : "spotify_api_error" }, { status });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo conectar Spotify." }, { status: 500 });
}

function publicArtist(artist: SpotifyArtist, matchedTrack?: SpotifyTrack | null) {
  return {
    id: artist.id,
    name: artist.name,
    url: artist.external_urls?.spotify || `https://open.spotify.com/artist/${artist.id}`,
    imageUrl: artist.images?.[0]?.url || null,
    genres: Array.isArray(artist.genres) ? artist.genres : [],
    matchedTrack: matchedTrack ? {
      id: matchedTrack.id,
      name: matchedTrack.name,
      url: matchedTrack.external_urls?.spotify || null,
    } : null,
  };
}

function cleanOEmbedTitle(title: string | undefined, fallbackName: string) {
  const cleaned = title
    ?.trim()
    .replace(/\s*[|·–—-]\s*Spotify(?:\s.*)?$/i, "")
    .trim();
  return cleaned || fallbackName;
}

async function spotifyArtistFromOEmbed(artistId: string, fallbackName: string): Promise<SpotifyArtist | null> {
  const spotifyProfileUrl = `https://open.spotify.com/artist/${artistId}`;
  const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyProfileUrl)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  }).catch(() => null);

  if (!response?.ok) return null;
  const payload = (await response.json().catch(() => null)) as SpotifyOEmbed | null;
  const embedHtml = payload?.html || "";
  const providerIsSpotify = payload?.provider_name?.toLowerCase() === "spotify";
  const isArtistEmbed = embedHtml.includes(`/embed/artist/${artistId}`);
  if (!payload || !providerIsSpotify || !isArtistEmbed) return null;

  return {
    id: artistId,
    name: cleanOEmbedTitle(payload.title, fallbackName),
    uri: `spotify:artist:${artistId}`,
    external_urls: { spotify: spotifyProfileUrl },
    images: payload.thumbnail_url
      ? [{ url: payload.thumbnail_url, width: payload.thumbnail_width ?? null, height: payload.thumbnail_height ?? null }]
      : [],
    genres: [],
  };
}

async function resolveSpotifyCatalogArtist(artistId: string, fallbackName: string) {
  const token = await getSpotifyAppAccessToken();
  try {
    const artist = await spotifyApiFetch<SpotifyArtist>({
      accessToken: token.access_token,
      path: `/artists/${encodeURIComponent(artistId)}`,
    });
    return { artist, accessToken: token.access_token, source: "web_api" as const };
  } catch (error) {
    if (error instanceof SpotifyApiError && error.status === 404) {
      const oEmbedArtist = await spotifyArtistFromOEmbed(artistId, fallbackName);
      if (oEmbedArtist) return { artist: oEmbedArtist, accessToken: token.access_token, source: "oembed" as const };
    }
    throw error;
  }
}

async function artistCatalogData(artist: SpotifyArtist, accessToken: string, source: "web_api" | "oembed") {
  let releases: SpotifyAlbum[] = [];
  if (source === "web_api") {
    const page = await spotifyApiFetch<SpotifyAlbumPage>({
      accessToken,
      path: `/artists/${encodeURIComponent(artist.id)}/albums?limit=10&offset=0`,
    }).catch(() => ({ items: [] }));
    releases = (page.items || []).filter((item) => item?.id && item?.name);
  }

  return {
    source,
    artist: publicArtist(artist),
    releases: releases.map((release) => ({
      id: release.id,
      name: release.name,
      type: release.album_type || null,
      releaseDate: release.release_date || null,
      totalTracks: typeof release.total_tracks === "number" ? release.total_tracks : null,
      url: release.external_urls?.spotify || `https://open.spotify.com/album/${release.id}`,
      imageUrl: release.images?.[0]?.url || null,
    })),
    syncedAt: new Date().toISOString(),
  };
}

async function persistCatalogArtist(options: {
  playerId: string;
  artist: SpotifyArtist;
  accessToken: string;
  source: "web_api" | "oembed";
}) {
  const { playerId, artist, accessToken, source } = options;
  const now = new Date().toISOString();
  const spotifyProfileUrl = artist.external_urls?.spotify || `https://open.spotify.com/artist/${artist.id}`;
  const catalogData = await artistCatalogData(artist, accessToken, source);
  const { data, error } = await createAdminSupabase()
    .from("players")
    .update({
      spotify_artist_id: artist.id,
      spotify_profile_url: spotifyProfileUrl,
      spotify_artist_data: catalogData,
      spotify_artist_data_updated_at: now,
      spotify_last_sync_at: now,
      spotify_sync_status: "connected",
      spotify_sync_error: null,
      updated_at: now,
    })
    .eq("id", playerId)
    .select([
      "id,slug,display_name,spotify_artist_id,spotify_profile_url,spotify_sync_status,spotify_last_sync_at",
      "spotify_for_artists_id,spotify_for_artists_url,spotify_for_artists_status,spotify_artist_data,spotify_artist_data_updated_at,spotify_for_artists_last_import_at",
    ].join(","))
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function persistForArtistsWorkspace(playerId: string, reference: SpotifyReference) {
  const now = new Date().toISOString();
  const { data, error } = await createAdminSupabase()
    .from("players")
    .update({
      spotify_for_artists_id: reference.id,
      spotify_for_artists_url: reference.url,
      spotify_for_artists_status: "connected",
      updated_at: now,
    })
    .eq("id", playerId)
    .select([
      "id,slug,display_name,spotify_artist_id,spotify_profile_url,spotify_sync_status,spotify_last_sync_at",
      "spotify_for_artists_id,spotify_for_artists_url,spotify_for_artists_status,spotify_artist_data,spotify_artist_data_updated_at,spotify_for_artists_last_import_at",
    ].join(","))
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const player = await ownedPlayer(user.id);
    if (!player) return NextResponse.json({ error: "Primero creá tu Player." }, { status: 404 });

    if (request.nextUrl.searchParams.get("current") === "1") {
      return NextResponse.json({ ok: true, player });
    }

    const query = request.nextUrl.searchParams.get("q")?.trim() || player.display_name?.trim() || "";
    const mode = request.nextUrl.searchParams.get("mode") === "track" ? "track" : "artist";
    const offset = Math.max(0, Math.min(90, Number(request.nextUrl.searchParams.get("offset") || 0) || 0));
    if (query.length < 2) {
      return NextResponse.json({ error: "Escribí al menos 2 caracteres para buscar en Spotify." }, { status: 400 });
    }

    const token = await getSpotifyAppAccessToken();
    if (mode === "track") {
      const result = await spotifyApiFetch<SpotifyTrackSearch>({
        accessToken: token.access_token,
        path: `/search?q=${encodeURIComponent(query)}&type=track&limit=10&offset=${offset}`,
      });
      const seen = new Set<string>();
      const artists = (result.tracks?.items || []).flatMap((track) =>
        (track.artists || []).map((artist) => ({ artist, track })),
      ).filter(({ artist }) => {
        if (!artist?.id || !artist?.name || seen.has(artist.id)) return false;
        seen.add(artist.id);
        return true;
      }).map(({ artist, track }) => publicArtist(artist, track));
      const total = Number(result.tracks?.total || 0);
      return NextResponse.json({
        ok: true,
        query,
        mode,
        artists,
        offset,
        nextOffset: offset + 10 < total ? offset + 10 : null,
      });
    }

    const result = await spotifyApiFetch<SpotifyArtistSearch>({
      accessToken: token.access_token,
      path: `/search?q=${encodeURIComponent(query)}&type=artist&limit=10&offset=${offset}`,
    });
    const artists = (result.artists?.items || []).filter((item) => item?.id && item?.name).map((item) => publicArtist(item));
    const total = Number(result.artists?.total || 0);
    return NextResponse.json({
      ok: true,
      query,
      mode,
      artists,
      offset,
      nextOffset: offset + 10 < total ? offset + 10 : null,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const player = await ownedPlayer(user.id);
    if (!player) return NextResponse.json({ error: "Primero creá tu Player." }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as {
      artistUrl?: unknown;
      artistId?: unknown;
      forArtistsUrl?: unknown;
      connectionKind?: unknown;
    };

    const explicitWorkspace = body.connectionKind === "for_artists_workspace" || body.forArtistsUrl !== undefined;
    const value = body.forArtistsUrl ?? body.artistUrl ?? body.artistId;
    const reference = parseSpotifyReference(value, explicitWorkspace ? "for_artists_workspace" : undefined);
    if (!reference) {
      return NextResponse.json({ error: "Pegá un enlace válido de Spotify o elegí un artista de los resultados." }, { status: 400 });
    }

    if (reference.kind === "for_artists_workspace") {
      const updated = await persistForArtistsWorkspace(String(player.id), reference);

      // The identifier used by Spotify for Artists is not guaranteed to be the same
      // resource exposed by the public Web API. If it is resolvable, link both sides;
      // otherwise keep the professional workspace connected without fabricating a
      // broken public artist URL.
      let catalogArtist: ReturnType<typeof publicArtist> | null = null;
      let publicPlayer = updated;
      try {
        const resolved = await resolveSpotifyCatalogArtist(reference.id, player.display_name || "Artista de Spotify");
        if (resolved.artist?.id && resolved.artist?.name) {
          publicPlayer = await persistCatalogArtist({
            playerId: String(player.id),
            artist: resolved.artist,
            accessToken: resolved.accessToken,
            source: resolved.source,
          });
          catalogArtist = publicArtist(resolved.artist);
        }
      } catch (error) {
        if (!(error instanceof SpotifyApiError && error.status === 404)) throw error;
      }

      return NextResponse.json({
        ok: true,
        workspace: { id: reference.id, url: reference.url, connected: true },
        publicArtistLinked: Boolean(catalogArtist),
        artist: catalogArtist,
        player: publicPlayer,
      });
    }

    const resolved = await resolveSpotifyCatalogArtist(reference.id, player.display_name || "Artista de Spotify");
    if (!resolved.artist?.id || !resolved.artist?.name) throw new Error("Spotify devolvió un perfil de artista inválido.");
    const updated = await persistCatalogArtist({
      playerId: String(player.id),
      artist: resolved.artist,
      accessToken: resolved.accessToken,
      source: resolved.source,
    });

    return NextResponse.json({
      ok: true,
      workspace: player.spotify_for_artists_id ? {
        id: player.spotify_for_artists_id,
        url: player.spotify_for_artists_url,
        connected: player.spotify_for_artists_status === "connected",
      } : null,
      publicArtistLinked: true,
      artist: publicArtist(resolved.artist),
      player: updated,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const player = await ownedPlayer(user.id);
    if (!player) return NextResponse.json({ error: "Primero creá tu Player." }, { status: 404 });

    const now = new Date().toISOString();
    const { error } = await createAdminSupabase()
      .from("players")
      .update({
        spotify_artist_id: null,
        spotify_profile_url: null,
        spotify_last_sync_at: now,
        spotify_sync_status: "disconnected",
        spotify_sync_error: null,
        spotify_artist_data: {},
        spotify_artist_data_updated_at: null,
        spotify_for_artists_id: null,
        spotify_for_artists_url: null,
        spotify_for_artists_status: "disconnected",
        updated_at: now,
      })
      .eq("id", player.id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
