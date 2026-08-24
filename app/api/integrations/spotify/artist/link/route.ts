import { NextRequest, NextResponse } from "next/server";
import { resolveSpotifyArtist, syncSpotifyPlayerCatalog } from "@/core/integrations/spotify/catalog";
import { isSpotifyEnabled } from "@/core/integrations/spotify/config";
import { requirePlayerMusicManager, upsertPlayerSpotifyArtist } from "@/core/integrations/spotify/player-music";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export async function POST(request: NextRequest) {
  try {
    if (!isSpotifyEnabled()) return NextResponse.json({ ok: false, code: "spotify_disabled" }, { status: 503 });
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { playerId?: unknown; value?: unknown };
    if (typeof body.playerId !== "string" || typeof body.value !== "string" || !body.value.trim()) {
      return NextResponse.json({ ok: false, code: "invalid_request" }, { status: 400 });
    }
    const admin = createAdminSupabase();
    await requirePlayerMusicManager(admin, user.id, body.playerId);
    const artist = await resolveSpotifyArtist(body.value);
    const connection = await upsertPlayerSpotifyArtist(admin, body.playerId, artist);
    let tracks = 0;
    let syncWarning: string | null = null;
    try {
      tracks = (await syncSpotifyPlayerCatalog({ admin, playerId: body.playerId, artist })).length;
    } catch (error) {
      syncWarning = error instanceof Error ? error.message.slice(0, 240) : "No se pudo sincronizar el catálogo.";
      await admin.from("players").update({ spotify_sync_status: "error", spotify_sync_error: syncWarning }).eq("id", body.playerId);
    }
    return NextResponse.json({ ok: true, artist, connection, tracks, syncWarning });
  } catch (error) {
    if (isAuthError(error)) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
    if (error instanceof Error && error.name === "PlayerMusicForbidden") return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 403 });
    return NextResponse.json({ ok: false, code: "spotify_api_error" }, { status: 502 });
  }
}
