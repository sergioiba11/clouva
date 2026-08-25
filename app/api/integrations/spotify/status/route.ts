import { NextRequest, NextResponse } from "next/server";
import { isSpotifyEnabled } from "@/core/integrations/spotify/config";
import { getSpotifyPublicConnection } from "@/core/integrations/spotify/service";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    if (!isSpotifyEnabled()) {
      return NextResponse.json({ ok: true, enabled: false, connection: { connected: false, provider: "spotify" } });
    }
    const connection = await getSpotifyPublicConnection(createAdminSupabase(), user.id);
    return NextResponse.json({ ok: true, enabled: true, connection });
  } catch (error) {
    if (isAuthError(error)) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, code: "spotify_api_error" }, { status: 500 });
  }
}
