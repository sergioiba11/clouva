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
      .select("id,player_id,status")
      .eq("id", id)
      .maybeSingle();
    if (versionError) throw new Error(versionError.message);
    if (!version) return NextResponse.json({ error: "La versión no existe." }, { status: 404 });
    if (version.status === "archived") {
      return NextResponse.json({ error: "No se puede publicar una versión archivada." }, { status: 409 });
    }

    await requireActiveVipEntitlement({ admin, userId: user.id, playerId: version.player_id as string });

    const { data: published, error: publishError } = await admin.rpc("publish_player_profile_version", {
      p_version_id: id,
    });
    if (publishError) throw new Error(publishError.message);

    return NextResponse.json({ version: published });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo publicar la versión.";
    return NextResponse.json({ error: message }, { status });
  }
}
