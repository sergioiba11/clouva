import { NextRequest, NextResponse } from "next/server";
import { resolveSpotifyArtist } from "@/core/integrations/spotify/catalog";
import { isSpotifyEnabled } from "@/core/integrations/spotify/config";
import { requirePlayerMusicManager } from "@/core/integrations/spotify/player-music";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export async function POST(request: NextRequest) {
  try {
    if (!isSpotifyEnabled()) return NextResponse.json({ ok: false, code: "spotify_disabled" }, { status: 503 });
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { value?: unknown; playerId?: unknown };
    if (typeof body.value !== "string" || !body.value.trim()) {
      return NextResponse.json({ ok: false, code: "invalid_request" }, { status: 400 });
    }
    const admin = createAdminSupabase();
    if (typeof body.playerId === "string" && body.playerId) {
      await requirePlayerMusicManager(admin, user.id, body.playerId);
    }
    const artist = await resolveSpotifyArtist(body.value);
    return NextResponse.json({ ok: true, artist });
  } catch (error) {
    if (isAuthError(error)) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
    if (error instanceof Error && error.name === "PlayerMusicForbidden") return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 403 });
    return NextResponse.json({ ok: false, code: "spotify_api_error" }, { status: 502 });
  }
}
