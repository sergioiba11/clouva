import { NextRequest, NextResponse } from "next/server";
import { getSpotifyAppAccessToken, SpotifyApiError, spotifyApiFetch } from "@/core/integrations/spotify/client";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

type SpotifyArtist = {
  id: string;
  name: string;
  uri: string;
  external_urls?: { spotify?: string };
  images?: Array<{ url: string; width?: number | null; height?: number | null }>;
  followers?: { total?: number };
  popularity?: number;
};

type SpotifyArtistSearch = {
  artists?: {
    items?: SpotifyArtist[];
  };
};

type SpotifyOEmbed = {
  title?: string;
  html?: string;
  provider_name?: string;
  thumbnail_url?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
};

const ARTIST_ID_RE = /^[A-Za-z0-9]{10,64}$/;

function parseArtistId(value: unknown) {
  if (typeof value !== "string") return null;
  const input = value.trim();
  const uriMatch = input.match(/^spotify:artist:([A-Za-z0-9]{10,64})$/i);
  if (uriMatch) return uriMatch[1];

  try {
    const url = new URL(input);
    const isOpenSpotify = /^(?:open\.)?spotify\.com$/i.test(url.hostname);
    const isSpotifyForArtists = /^artists\.spotify\.com$/i.test(url.hostname);
    if (!isOpenSpotify && !isSpotifyForArtists) return null;

    const parts = url.pathname.split("/").filter(Boolean);
    const artistIndex = parts.findIndex((part) => part.toLowerCase() === "artist");
    const id = artistIndex >= 0 ? parts[artistIndex + 1] : null;
    return id && ARTIST_ID_RE.test(id) ? id : null;
  } catch {
    return ARTIST_ID_RE.test(input) ? input : null;
  }
}

async function ownedPlayer(userId: string) {
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("players")
    .select("id,slug,display_name,spotify_artist_id,spotify_profile_url,spotify_sync_status")
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
      ? "No encontramos ese perfil de artista en Spotify."
      : status === 429
        ? "Spotify está limitando solicitudes. Probá de nuevo en un momento."
        : "Spotify no pudo validar el perfil de artista.";
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo conectar Spotify Artist." }, { status: 500 });
}

function publicArtist(artist: SpotifyArtist) {
  return {
    id: artist.id,
    name: artist.name,
    url: artist.external_urls?.spotify || `https://open.spotify.com/artist/${artist.id}`,
    imageUrl: artist.images?.[0]?.url || null,
    followers: Number(artist.followers?.total || 0),
    popularity: Number(artist.popularity || 0),
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
    followers: { total: 0 },
    popularity: 0,
  };
}

async function resolveSpotifyArtist(artistId: string, fallbackName: string) {
  const token = await getSpotifyAppAccessToken();
  try {
    return await spotifyApiFetch<SpotifyArtist>({
      accessToken: token.access_token,
      path: `/artists/${encodeURIComponent(artistId)}`,
    });
  } catch (error) {
    // Some valid/public artist pages can be omitted by the catalog view available
    // to a Spotify Web API app. Spotify's official oEmbed endpoint still exposes
    // and validates the public artist page used by our embedded player.
    if (error instanceof SpotifyApiError && error.status === 404) {
      const oEmbedArtist = await spotifyArtistFromOEmbed(artistId, fallbackName);
      if (oEmbedArtist) return oEmbedArtist;
    }
    throw error;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const player = await ownedPlayer(user.id);
    if (!player) return NextResponse.json({ error: "Primero creá tu Player." }, { status: 404 });

    const query = request.nextUrl.searchParams.get("q")?.trim() || player.display_name?.trim() || "";
    if (query.length < 2) {
      return NextResponse.json({ error: "Escribí al menos 2 caracteres para buscar tu artista." }, { status: 400 });
    }

    const token = await getSpotifyAppAccessToken();
    const result = await spotifyApiFetch<SpotifyArtistSearch>({
      accessToken: token.access_token,
      path: `/search?q=${encodeURIComponent(query)}&type=artist&limit=8`,
    });

    const artists = (result.artists?.items || []).filter((item) => item?.id && item?.name).map(publicArtist);
    return NextResponse.json({ ok: true, query, artists });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const player = await ownedPlayer(user.id);
    if (!player) return NextResponse.json({ error: "Primero creá tu Player." }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as { artistUrl?: unknown; artistId?: unknown };
    const artistId = parseArtistId(body.artistUrl ?? body.artistId);
    if (!artistId) {
      return NextResponse.json({ error: "Elegí un artista de los resultados o pegá un enlace válido de Spotify." }, { status: 400 });
    }

    const artist = await resolveSpotifyArtist(artistId, player.display_name || "Artista de Spotify");
    if (!artist?.id || !artist?.name) throw new Error("Spotify devolvió un perfil de artista inválido.");

    const spotifyProfileUrl = artist.external_urls?.spotify || `https://open.spotify.com/artist/${artist.id}`;
    const now = new Date().toISOString();
    const admin = createAdminSupabase();
    const { data: updated, error } = await admin
      .from("players")
      .update({
        spotify_artist_id: artist.id,
        spotify_profile_url: spotifyProfileUrl,
        spotify_last_sync_at: now,
        spotify_sync_status: "connected",
        spotify_sync_error: null,
        updated_at: now,
      })
      .eq("id", player.id)
      .select("id,slug,display_name,spotify_artist_id,spotify_profile_url,spotify_sync_status,spotify_last_sync_at")
      .single();
    if (error) throw new Error(error.message);

    return NextResponse.json({
      ok: true,
      artist: publicArtist(artist),
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
        updated_at: now,
      })
      .eq("id", player.id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
