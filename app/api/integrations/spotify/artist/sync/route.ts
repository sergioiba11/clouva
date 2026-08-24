import { NextRequest, NextResponse } from "next/server";
import { syncSpotifyPlayerCatalog } from "@/core/integrations/spotify/catalog";
import { isSpotifyEnabled } from "@/core/integrations/spotify/config";
import { requirePlayerMusicManager } from "@/core/integrations/spotify/player-music";
import type { NormalizedArtist } from "@/core/integrations/spotify/types";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export async function POST(request: NextRequest) {
  try {
    if (!isSpotifyEnabled()) return NextResponse.json({ ok: false, code: "spotify_disabled" }, { status: 503 });
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { playerId?: unknown };
    if (typeof body.playerId !== "string") return NextResponse.json({ ok: false, code: "invalid_request" }, { status: 400 });
    const admin = createAdminSupabase();
    await requirePlayerMusicManager(admin, user.id, body.playerId);
    const { data, error } = await admin
      .from("player_music_connections")
      .select("external_artist_id,external_uri,external_url,artist_name,artist_image_url")
      .eq("player_id", body.playerId)
      .eq("provider", "spotify")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ ok: false, code: "invalid_request" }, { status: 404 });
    const artist: NormalizedArtist = {
      provider: "spotify",
      id: data.external_artist_id,
      uri: data.external_uri,
      externalUrl: data.external_url,
      name: data.artist_name,
      imageUrl: data.artist_image_url,
    };
    const tracks = await syncSpotifyPlayerCatalog({ admin, playerId: body.playerId, artist });
    return NextResponse.json({ ok: true, tracks: tracks.length });
  } catch (error) {
    if (isAuthError(error)) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
    if (error instanceof Error && error.name === "PlayerMusicForbidden") return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 403 });
    return NextResponse.json({ ok: false, code: "spotify_api_error" }, { status: 502 });
  }
}
