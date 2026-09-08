import { NextRequest, NextResponse } from "next/server";
import { getOwnedPlayerBasics, playerBasicsComplete } from "@/lib/server/player-basics";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function findEditablePlayer(admin: ReturnType<typeof createAdminSupabase>, userId: string) {
  const { data: owned, error: ownedError } = await admin
    .from("players")
    .select("*")
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (ownedError) throw new Error(ownedError.message);
  if (owned) return owned;

  const { data: member, error: memberError } = await admin
    .from("player_members")
    .select("player_id,role")
    .eq("user_id", userId)
    .eq("status", "active")
    .in("role", ["owner", "manager", "editor"])
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!member) return null;

  const { data, error } = await admin.from("players").select("*").eq("id", member.player_id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const [player, ownedBasics] = await Promise.all([
      findEditablePlayer(admin, user.id),
      getOwnedPlayerBasics(admin, user.id),
    ]);

    return NextResponse.json({
      player,
      playerBasics: {
        player: ownedBasics,
        complete: playerBasicsComplete(ownedBasics),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo iniciar CLOUVA.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}
