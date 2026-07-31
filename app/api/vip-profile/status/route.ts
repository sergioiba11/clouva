import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only, ownership-gated but NOT VIP-gated -- a Player whose VIP lapsed
// must still be able to see their last published version (spec section 15:
// "la última versión VIP publicada continúa visible"). Starting a new
// generation is what actually requires active VIP (enforced in
// /api/vip-profile/generate via requireActiveVipEntitlement).
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const playerId = request.nextUrl.searchParams.get("playerId")?.trim();
    if (!playerId) return NextResponse.json({ error: "Falta playerId." }, { status: 400 });

    const admin = createAdminSupabase();
    const [{ data: player, error: playerError }, { data: membership, error: membershipError }] = await Promise.all([
      admin.from("players").select("id,owner_user_id").eq("id", playerId).maybeSingle(),
      admin.from("player_members").select("role").eq("player_id", playerId).eq("user_id", user.id).eq("status", "active").maybeSingle(),
    ]);
    if (playerError) throw new Error(playerError.message);
    if (membershipError) throw new Error(membershipError.message);
    if (!player) return NextResponse.json({ error: "El Player no existe." }, { status: 404 });
    if (player.owner_user_id !== user.id && !membership) {
      return NextResponse.json({ error: "No tenés permiso para ver este Player." }, { status: 403 });
    }

    const [{ data: job, error: jobError }, { data: versions, error: versionsError }] = await Promise.all([
      admin
        .from("vip_profile_generation_jobs")
        .select("id,status,generated_copy,generated_assets,error_message,actual_cost_usd,created_at,completed_at")
        .eq("player_id", playerId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("player_profile_versions")
        .select("id,version_number,status,profile_level,copy_config,asset_references,created_at,published_at")
        .eq("player_id", playerId)
        .order("version_number", { ascending: false }),
    ]);
    if (jobError) throw new Error(jobError.message);
    if (versionsError) throw new Error(versionsError.message);

    return NextResponse.json({ job, versions: versions ?? [] });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo cargar el estado.";
    return NextResponse.json({ error: message }, { status });
  }
}
