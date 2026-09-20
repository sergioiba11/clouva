import { NextRequest, NextResponse } from "next/server";
import { getFacebookConfig, isFacebookEnabled } from "@/core/integrations/facebook/config";
import { createFacebookState } from "@/core/integrations/facebook/state";
import { resolveBusinessPublisherAccess } from "@/lib/server/facebook-publisher";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { spaceId?: string };
    const spaceId = body.spaceId?.trim();
    if (!spaceId) return NextResponse.json({ error: "Falta el Bisnes destino." }, { status: 400 });
    if (!isFacebookEnabled()) {
      return NextResponse.json({
        error: "Facebook OAuth todavía no está configurado en Cloud Run.",
        code: "FACEBOOK_OAUTH_NOT_CONFIGURED",
      }, { status: 503 });
    }

    const admin = createAdminSupabase();
    await resolveBusinessPublisherAccess({ admin, userId: user.id, spaceId });
    const state = await createFacebookState({ admin, userId: user.id, spaceId });
    const config = getFacebookConfig();
    const url = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
    url.searchParams.set("client_id", config.appId);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("state", state.rawState);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", config.scopes.join(","));

    return NextResponse.json({ authorizationUrl: url.toString(), expiresAt: state.expiresAt });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo iniciar Facebook.",
    }, { status: isAuthError(error) ? 401 : ((error as Error & { status?: number })?.status ?? 500) });
  }
}
