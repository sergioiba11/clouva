import { NextRequest, NextResponse } from "next/server";
import { buildYoutubeAuthorizationUrl } from "@/core/integrations/youtube/client";
import { isYoutubeEnabled } from "@/core/integrations/youtube/config";
import { createYoutubeState } from "@/core/integrations/youtube/state";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    if (!isYoutubeEnabled()) return NextResponse.json({ error: "YouTube todavía no está configurado en CLOUVA." }, { status: 503 });
    const body = (await request.json().catch(() => ({}))) as { returnPath?: string };
    const state = await createYoutubeState({ admin: createAdminSupabase(), userId: user.id, returnPath: body.returnPath });
    return NextResponse.json({ authorizeUrl: buildYoutubeAuthorizationUrl(state.rawState), expiresAt: state.expiresAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo iniciar YouTube.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}
