import { NextRequest, NextResponse } from "next/server";
import { getSpotifyAppAccessToken, SpotifyApiError, spotifyApiFetch } from "@/core/integrations/spotify/client";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

type SpotifyArtist = {
  id: string;
  name: string;
  uri: string;
  external_urls?: { spotify?: string };
  images?: Array<{ url: string; width?: number | null; height?: number | null }>;
};

const ARTIST_ID_RE = /^[A-Za-z0-9]{10,64}$/;

function parseArtistId(value: unknown) {
  if (typeof value !== "string") return null;
  const input = value.trim();
  const uriMatch = input.match(/^spotify:artist:([A-Za-z0-9]{10,64})$/i);
  if (uriMatch) return uriMatch[1];

  try {
    const url = new URL(input);
    if (!/^(?:open\.)?spotify\.com$/i.test(url.hostname)) return null;
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

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const player = await ownedPlayer(user.id);
    if (!player) return NextResponse.json({ error: "Primero creá tu Player." }, { status: 404 });

    const body = (await request.json().catch(() => ({}))) as { artistUrl?: unknown; artistId?: unknown };
    const artistId = parseArtistId(body.artistUrl ?? body.artistId);
    if (!artistId) {
      return NextResponse.json({ error: "Pegá un enlace de artista de Spotify válido (open.spotify.com/artist/...)." }, { status: 400 });
    }

    const token = await getSpotifyAppAccessToken();
    const artist = await spotifyApiFetch<SpotifyArtist>({
      accessToken: token.access_token,
      path: `/artists/${encodeURIComponent(artistId)}`,
    });
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
      artist: {
        id: artist.id,
        name: artist.name,
        url: spotifyProfileUrl,
        imageUrl: artist.images?.[0]?.url || null,
      },
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
