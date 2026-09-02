import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const raw = (request.nextUrl.searchParams.get("q") || "").trim().slice(0, 80);
    const q = raw.replace(/^@+/, "").replace(/[%(),]/g, "").trim();

    let query = admin
      .from("players")
      .select("id,display_name,username,profile_image_url,privacy_status,owner_user_id")
      .neq("privacy_status", "private")
      .order("display_name")
      .limit(20);
    if (q) query = query.or(`display_name.ilike.%${q}%,username.ilike.%${q}%`);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return NextResponse.json({
      players: (data ?? [])
        .filter((player) => player.owner_user_id !== user.id)
        .map((player) => ({
          id: player.id,
          displayName: player.display_name || player.username || "Player",
          username: player.username || null,
          avatar: player.profile_image_url || null,
        })),
    });
  } catch (error) {
    const typed = error as Error & { status?: number; code?: string };
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudieron buscar Players.", ...(typed.code ? { code: typed.code } : {}) },
      { status: typed.status ?? (isAuthError(error) ? 401 : 500) },
    );
  }
}
