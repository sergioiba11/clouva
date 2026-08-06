import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireActiveVipEntitlement } from "@/lib/server/vip-profile-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Publishing an expired-VIP Player's version stays possible on purpose --
// spec section 15: "Si VIP vence, la última versión VIP publicada continúa
// visible" -- but re-publishing/regenerating requires active VIP again.
// requireActiveVipEntitlement already enforces that; this route just calls
// the atomic RPC once entitlement + ownership are confirmed.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();

    const { data: version, error: versionError } = await admin
      .from("player_profile_versions")
      .select("id,player_id,studio_id,status")
      .eq("id", id)
      .maybeSingle();
    if (versionError) throw new Error(versionError.message);
    if (!version) return NextResponse.json({ error: "La versión no existe." }, { status: 404 });
    if (version.status === "archived") {
      return NextResponse.json({ error: "No se puede publicar una versión archivada." }, { status: 409 });
    }

    await requireActiveVipEntitlement({
      admin,
      userId: user.id,
      playerId: (version.player_id as string | null) ?? undefined,
      studioId: (version.studio_id as string | null) ?? undefined,
    });

    // Publicar la página nunca publica el logo solo -- regla explícita del
    // usuario. Sin confirmación, un brand_asset_version en draft/approved
    // ligado a esta versión se sigue viendo en la página (image_slots.logo ya
    // apunta a su URL real) pero players.logo_url/studios.logo_url/
    // brand_assets.active_version_id quedan intactos. El caller debe haber
    // mostrado la confirmación ("¿Querés publicar también este logo como
    // identidad oficial?") antes de mandar publishLogoToo: true.
    let publishLogoToo = false;
    try {
      const body = await request.json();
      publishLogoToo = body?.publishLogoToo === true;
    } catch {
      // Sin body (o no-JSON) -- valor por defecto false, comportamiento
      // conservador (nunca publicar el logo sin confirmación explícita).
    }

    const { data: published, error: publishError } = await admin.rpc("publish_player_profile_version", {
      p_version_id: id,
      p_publish_logo_too: publishLogoToo,
    });
    if (publishError) throw new Error(publishError.message);

    return NextResponse.json({ version: published });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo publicar la versión.";
    return NextResponse.json({ error: message }, { status });
  }
}
