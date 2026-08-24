import { NextRequest, NextResponse } from "next/server";
import { buildSpotifyAuthorizationUrl } from "@/core/integrations/spotify/client";
import { isSpotifyEnabled } from "@/core/integrations/spotify/config";
import { createSpotifyState } from "@/core/integrations/spotify/state";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export async function POST(request: NextRequest) {
  try {
    if (!isSpotifyEnabled()) {
      return NextResponse.json({ ok: false, code: "spotify_disabled" }, { status: 503 });
    }
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { returnPath?: unknown; pendingAction?: unknown };
    const state = await createSpotifyState({
      admin: createAdminSupabase(),
      userId: user.id,
      returnPath: body.returnPath,
      pendingAction: body.pendingAction,
    });
    return NextResponse.json({ ok: true, authorizeUrl: buildSpotifyAuthorizationUrl(state.rawState), expiresAt: state.expiresAt });
  } catch (error) {
    if (isAuthError(error)) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
    return NextResponse.json({ ok: false, code: "spotify_api_error" }, { status: 500 });
  }
}
