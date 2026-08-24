import { NextRequest, NextResponse } from "next/server";
import { SpotifyApiError } from "@/core/integrations/spotify/client";
import {
  isSpotifyUriSaved,
  removeSpotifyUri,
  saveSpotifyUri,
  SpotifyConnectionError,
} from "@/core/integrations/spotify/service";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

const TRACK_URI_RE = /^spotify:track:[A-Za-z0-9]+$/;

function parseTrackUri(value: unknown) {
  if (typeof value !== "string") return null;
  const uri = value.trim();
  return TRACK_URI_RE.test(uri) ? uri : null;
}

function spotifyError(error: unknown) {
  if (isAuthError(error)) {
    return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  }
  if (error instanceof SpotifyConnectionError) {
    return NextResponse.json({ ok: false, code: error.code }, { status: 409 });
  }
  if (error instanceof SpotifyApiError) {
    const status = error.status >= 400 && error.status <= 599 ? error.status : 502;
    return NextResponse.json(
      {
        ok: false,
        code: status === 403 ? "spotify_access_denied" : status === 429 ? "spotify_rate_limited" : "spotify_api_error",
      },
      { status },
    );
  }
  return NextResponse.json({ ok: false, code: "spotify_api_error" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const uri = parseTrackUri(request.nextUrl.searchParams.get("uri"));
    if (!uri) return NextResponse.json({ ok: false, code: "invalid_track_uri" }, { status: 400 });

    const { user } = await requireUser(request);
    const saved = await isSpotifyUriSaved(createAdminSupabase(), user.id, uri);
    return NextResponse.json({ ok: true, saved });
  } catch (error) {
    return spotifyError(error);
  }
}

async function mutate(request: NextRequest, action: "save" | "remove") {
  try {
    const body = (await request.json().catch(() => ({}))) as { uri?: unknown };
    const uri = parseTrackUri(body.uri);
    if (!uri) return NextResponse.json({ ok: false, code: "invalid_track_uri" }, { status: 400 });

    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    if (action === "save") await saveSpotifyUri(admin, user.id, uri);
    else await removeSpotifyUri(admin, user.id, uri);

    return NextResponse.json({ ok: true, saved: action === "save" });
  } catch (error) {
    return spotifyError(error);
  }
}

export async function PUT(request: NextRequest) {
  return mutate(request, "save");
}

export async function DELETE(request: NextRequest) {
  return mutate(request, "remove");
}
