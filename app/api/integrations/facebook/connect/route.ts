import { NextRequest, NextResponse } from "next/server";
import { facebookAuthorizationUrl } from "@/core/integrations/facebook/client";
import { isFacebookEnabled } from "@/core/integrations/facebook/config";
import { createFacebookState } from "@/core/integrations/facebook/state";
import { requireSpotAccess } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    if (!isFacebookEnabled()) {
      return NextResponse.json({
        error: "La conexión Meta todavía no tiene credenciales configuradas en Cloud Run.",
        code: "FACEBOOK_NOT_CONFIGURED",
      }, { status: 503 });
    }

    const body = (await request.json().catch(() => ({}))) as { spotId?: string; returnPath?: string };
    const spotId = String(body.spotId || "").trim();
    if (!spotId) return NextResponse.json({ error: "Falta el Spot." }, { status: 400 });

    const admin = createAdminSupabase();
    await requireSpotAccess({ admin, userId: user.id, spotId, capability: "content" });
    const returnPath = body.returnPath || "/mi-spot/publicador/facebook?spotId=" + encodeURIComponent(spotId);
    const state = await createFacebookState({ admin, userId: user.id, returnPath });
    return NextResponse.json({ authorizationUrl: facebookAuthorizationUrl(state.rawState) });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo iniciar Facebook.",
    }, { status });
  }
}
