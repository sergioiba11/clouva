import { NextRequest, NextResponse } from "next/server";
import { isSpotifyEnabled } from "@/core/integrations/spotify/config";
import {
  getSpotifyPublicConnection,
  SpotifyConnectionError,
  spotifyUserApi,
} from "@/core/integrations/spotify/service";
import { SpotifyApiError } from "@/core/integrations/spotify/client";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

const READ_SCOPES = ["user-read-playback-state", "user-read-currently-playing"] as const;
const CONTROL_SCOPE = "user-modify-playback-state";
const PLAYBACK_SCOPES = [...READ_SCOPES, CONTROL_SCOPE] as const;

type SpotifyPlayerResponse = {
  is_playing?: boolean;
  progress_ms?: number | null;
  device?: {
    id?: string | null;
    name?: string | null;
    type?: string | null;
    is_active?: boolean;
    volume_percent?: number | null;
  } | null;
  item?: {
    id?: string | null;
    uri?: string | null;
    name?: string | null;
    duration_ms?: number | null;
    external_urls?: { spotify?: string | null } | null;
    album?: {
      id?: string | null;
      name?: string | null;
      images?: Array<{ url?: string | null; height?: number | null; width?: number | null }> | null;
    } | null;
    artists?: Array<{ id?: string | null; name?: string | null; uri?: string | null }> | null;
  } | null;
};

type PlaybackAction = "play" | "pause" | "next" | "previous";

function scopesReady(scopes: string[]) {
  const current = new Set(scopes);
  return PLAYBACK_SCOPES.every((scope) => current.has(scope));
}

function normalizePlayback(payload: SpotifyPlayerResponse | undefined) {
  const item = payload?.item;
  if (!payload || !item?.id || !item.name) return null;
  const durationMs = Math.max(0, Number(item.duration_ms || 0));
  const progressMs = Math.min(durationMs || Number.MAX_SAFE_INTEGER, Math.max(0, Number(payload.progress_ms || 0)));
  return {
    isPlaying: Boolean(payload.is_playing),
    progressMs,
    durationMs,
    device: payload.device ? {
      id: payload.device.id || null,
      name: payload.device.name || null,
      type: payload.device.type || null,
      isActive: Boolean(payload.device.is_active),
      volumePercent: typeof payload.device.volume_percent === "number" ? payload.device.volume_percent : null,
    } : null,
    track: {
      id: item.id,
      uri: item.uri || null,
      title: item.name,
      artist: (item.artists || []).map((artist) => artist.name).filter(Boolean).join(", ") || "Spotify",
      album: item.album?.name || null,
      albumId: item.album?.id || null,
      coverUrl: item.album?.images?.find((image) => image.url)?.url || null,
      externalUrl: item.external_urls?.spotify || null,
    },
  };
}

function spotifyErrorResponse(error: unknown) {
  if (isAuthError(error)) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  if (error instanceof SpotifyConnectionError) {
    return NextResponse.json({ ok: false, code: error.code }, { status: 409 });
  }
  if (error instanceof SpotifyApiError) {
    if (error.status === 403) return NextResponse.json({ ok: false, code: "spotify_permission_missing" }, { status: 403 });
    if (error.status === 404) return NextResponse.json({ ok: false, code: "spotify_no_active_device" }, { status: 409 });
    if (error.status === 429) return NextResponse.json({ ok: false, code: "spotify_rate_limited" }, { status: 429 });
  }
  return NextResponse.json({ ok: false, code: "spotify_api_error" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    if (!isSpotifyEnabled()) {
      return NextResponse.json({ ok: true, enabled: false, connected: false, scopesReady: false, playback: null });
    }

    const admin = createAdminSupabase();
    const connection = await getSpotifyPublicConnection(admin, user.id);
    if (!connection.connected) {
      return NextResponse.json({ ok: true, enabled: true, connected: false, scopesReady: false, connection, playback: null });
    }

    const ready = scopesReady(connection.scopes);
    if (!ready) {
      return NextResponse.json({ ok: true, enabled: true, connected: true, scopesReady: false, connection, playback: null });
    }

    const payload = await spotifyUserApi<SpotifyPlayerResponse | undefined>(admin, user.id, "/me/player");
    return NextResponse.json({
      ok: true,
      enabled: true,
      connected: true,
      scopesReady: true,
      connection,
      playback: normalizePlayback(payload),
    });
  } catch (error) {
    return spotifyErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    if (!isSpotifyEnabled()) return NextResponse.json({ ok: false, code: "spotify_disabled" }, { status: 503 });

    const body = (await request.json().catch(() => null)) as { action?: PlaybackAction } | null;
    const action = body?.action;
    if (!action || !(["play", "pause", "next", "previous"] as PlaybackAction[]).includes(action)) {
      return NextResponse.json({ ok: false, code: "invalid_request" }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const connection = await getSpotifyPublicConnection(admin, user.id);
    if (!connection.connected) return NextResponse.json({ ok: false, code: "spotify_connection_required" }, { status: 409 });
    if (!scopesReady(connection.scopes)) return NextResponse.json({ ok: false, code: "spotify_permission_missing" }, { status: 403 });

    if (action === "play") await spotifyUserApi<void>(admin, user.id, "/me/player/play", "PUT");
    if (action === "pause") await spotifyUserApi<void>(admin, user.id, "/me/player/pause", "PUT");
    if (action === "next") await spotifyUserApi<void>(admin, user.id, "/me/player/next", "POST");
    if (action === "previous") await spotifyUserApi<void>(admin, user.id, "/me/player/previous", "POST");

    return NextResponse.json({ ok: true, action });
  } catch (error) {
    return spotifyErrorResponse(error);
  }
}
