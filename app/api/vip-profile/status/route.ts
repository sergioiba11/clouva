import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Read-only, ownership-gated but NOT VIP-gated -- a subject whose VIP lapsed
// must still be able to see their last published version. Works for either a
// Player or an Estudio, playerId XOR studioId in the query.
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const playerId = request.nextUrl.searchParams.get("playerId")?.trim() || null;
    const studioId = request.nextUrl.searchParams.get("studioId")?.trim() || null;
    if (!playerId && !studioId) return NextResponse.json({ error: "Falta playerId o studioId." }, { status: 400 });

    const admin = createAdminSupabase();
    if (playerId) {
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
    } else {
      const [{ data: studio, error: studioError }, { data: membership, error: membershipError }] = await Promise.all([
        admin.from("studios").select("id,owner_id").eq("id", studioId).maybeSingle(),
        admin.from("studio_members").select("role").eq("studio_id", studioId).eq("profile_id", user.id).eq("status", "active").maybeSingle(),
      ]);
      if (studioError) throw new Error(studioError.message);
      if (membershipError) throw new Error(membershipError.message);
      if (!studio) return NextResponse.json({ error: "El Estudio no existe." }, { status: 404 });
      if (studio.owner_id !== user.id && !membership) {
        return NextResponse.json({ error: "No tenés permiso para ver este Estudio." }, { status: 403 });
      }
    }

    const subjectColumn = playerId ? "player_id" : "studio_id";
    const subjectId = playerId || studioId;
    const [{ data: job, error: jobError }, { data: versions, error: versionsError }] = await Promise.all([
      admin
        .from("vip_profile_generation_jobs")
        .select("id,status,generated_copy,generated_assets,layout_variants,error_message,actual_cost_usd,created_at,completed_at")
        .eq(subjectColumn, subjectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("player_profile_versions")
        .select("id,version_number,status,profile_level,copy_config,layout_config,asset_references,brand_asset_version_id,created_at,published_at")
        .eq(subjectColumn, subjectId)
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
