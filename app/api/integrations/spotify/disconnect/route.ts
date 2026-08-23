import { NextRequest, NextResponse } from "next/server";
import { disconnectSpotify } from "@/core/integrations/spotify/service";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    await disconnectSpotify(createAdminSupabase(), user.id);
    return NextResponse.json({ ok: true, connected: false });
  } catch (error) {
    if (isAuthError(error)) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, code: "spotify_api_error" }, { status: 500 });
  }
}
