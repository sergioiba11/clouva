import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function uniqueById<T extends { id: string }>(rows: T[]) {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await requireUser(request);

    const [ownedPlayers, playerMemberships, ownedStudios, studioMemberships, ownedSpots, spotMemberships] = await Promise.all([
      supabase.from("players").select("id,name:display_name,slug").eq("owner_user_id", user.id),
      supabase.from("player_members").select("player_id,role").eq("user_id", user.id).eq("status", "active").in("role", ["owner", "manager", "editor"]),
      supabase.from("studios").select("id,name,slug").eq("owner_id", user.id),
      supabase.from("studio_members").select("studio_id,role").eq("profile_id", user.id).eq("status", "active").in("role", ["owner", "admin", "manager", "editor"]),
      supabase.from("commerce_spots").select("id,name,slug,studio_id,owner_type,owner_user_id,currency").or(`owner_user_id.eq.${user.id},created_by.eq.${user.id}`).eq("status", "active"),
      supabase.from("commerce_spot_members").select("spot_id,role").eq("user_id", user.id).eq("status", "active").in("role", ["owner", "admin", "manager", "catalog"]),
    ]);

    for (const result of [ownedPlayers, playerMemberships, ownedStudios, studioMemberships, ownedSpots, spotMemberships]) {
      if (result.error) throw new Error(result.error.message);
    }

    const memberPlayerIds = [...new Set((playerMemberships.data ?? []).map((row) => row.player_id).filter(Boolean))];
    const memberStudioIds = [...new Set((studioMemberships.data ?? []).map((row) => row.studio_id).filter(Boolean))];
    const memberSpotIds = [...new Set((spotMemberships.data ?? []).map((row) => row.spot_id).filter(Boolean))];

    const [memberPlayers, memberStudios, memberSpots] = await Promise.all([
      memberPlayerIds.length ? supabase.from("players").select("id,name:display_name,slug").in("id", memberPlayerIds) : Promise.resolve({ data: [], error: null }),
      memberStudioIds.length ? supabase.from("studios").select("id,name,slug").in("id", memberStudioIds) : Promise.resolve({ data: [], error: null }),
      memberSpotIds.length ? supabase.from("commerce_spots").select("id,name,slug,studio_id,owner_type,owner_user_id,currency").in("id", memberSpotIds) : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [memberPlayers, memberStudios, memberSpots]) {
      if (result.error) throw new Error(result.error.message);
    }

    return NextResponse.json({
      user: { id: user.id },
      players: uniqueById([...(ownedPlayers.data ?? []), ...(memberPlayers.data ?? [])] as Array<{ id: string; name: string; slug: string }>),
      studios: uniqueById([...(ownedStudios.data ?? []), ...(memberStudios.data ?? [])] as Array<{ id: string; name: string; slug: string }>),
      spots: uniqueById([...(ownedSpots.data ?? []), ...(memberSpots.data ?? [])] as Array<{ id: string; name: string; slug: string; studio_id: string | null; owner_type: string; owner_user_id: string | null; currency: string }>),
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron cargar tus contextos comerciales." }, { status });
  }
}
