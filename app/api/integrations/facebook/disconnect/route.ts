import { NextRequest, NextResponse } from "next/server";
import { requireSpotAccess } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { spotId?: string };
    const spotId = String(body.spotId || "").trim();
    if (!spotId) return NextResponse.json({ error: "Falta el Spot." }, { status: 400 });

    const admin = createAdminSupabase();
    await requireSpotAccess({ admin, userId: user.id, spotId, capability: "content" });
    const now = new Date().toISOString();

    const { error: connectionError } = await admin.from("commerce_facebook_connections").upsert({
      user_id: user.id,
      status: "not_connected",
      facebook_user_id: null,
      display_name: null,
      encrypted_access_token: null,
      token_expires_at: null,
      scopes: [],
      last_verified_at: now,
      attention_reason: null,
      metadata: {},
      updated_at: now,
    }, { onConflict: "user_id" });
    if (connectionError) throw new Error(connectionError.message);

    const { error: destinationsError } = await admin.from("facebook_destinations")
      .update({ encrypted_access_token: null, updated_at: now })
      .eq("user_id", user.id)
      .eq("spot_id", spotId)
      .eq("type", "page");
    if (destinationsError) throw new Error(destinationsError.message);

    return NextResponse.json({ status: "not_connected" });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo desconectar Facebook.",
    }, { status });
  }
}
