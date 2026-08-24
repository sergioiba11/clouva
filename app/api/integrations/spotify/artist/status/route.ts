import { NextRequest, NextResponse } from "next/server";
import { requirePlayerMusicManager } from "@/core/integrations/spotify/player-music";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const playerId = request.nextUrl.searchParams.get("playerId") || "";
    if (!playerId) return NextResponse.json({ ok: false, code: "invalid_request" }, { status: 400 });
    const admin = createAdminSupabase();
    await requirePlayerMusicManager(admin, user.id, playerId);
    const { data, error } = await admin
      .from("player_music_connections")
      .select("id,player_id,provider,external_artist_id,external_uri,external_url,artist_name,artist_image_url,verification_status,last_synced_at")
      .eq("player_id", playerId)
      .eq("provider", "spotify")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, connection: data || null });
  } catch (error) {
    if (isAuthError(error)) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
    if (error instanceof Error && error.name === "PlayerMusicForbidden") return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 403 });
    return NextResponse.json({ ok: false, code: "spotify_api_error" }, { status: 500 });
  }
}
