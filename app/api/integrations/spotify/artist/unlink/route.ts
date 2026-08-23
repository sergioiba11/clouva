import { NextRequest, NextResponse } from "next/server";
import { requirePlayerMusicManager, unlinkPlayerSpotifyArtist } from "@/core/integrations/spotify/player-music";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { playerId?: unknown };
    if (typeof body.playerId !== "string") return NextResponse.json({ ok: false, code: "invalid_request" }, { status: 400 });
    const admin = createAdminSupabase();
    await requirePlayerMusicManager(admin, user.id, body.playerId);
    await unlinkPlayerSpotifyArtist(admin, body.playerId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isAuthError(error)) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
    if (error instanceof Error && error.name === "PlayerMusicForbidden") return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 403 });
    return NextResponse.json({ ok: false, code: "spotify_api_error" }, { status: 500 });
  }
}
