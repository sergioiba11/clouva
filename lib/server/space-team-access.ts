import "server-only";

import { createAdminSupabase } from "@/lib/server/supabase";

type AdminClient = ReturnType<typeof createAdminSupabase>;

export async function getOwnedPlayerId(admin: AdminClient, userId: string) {
  const { data, error } = await admin.from("players").select("id").eq("owner_user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ? String(data.id) : null;
}

export async function getSpaceTeamRole(admin: AdminClient, userId: string, spaceId: string) {
  const { data: profile, error: profileError } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (profile?.role === "admin") return "admin";

  const playerId = await getOwnedPlayerId(admin, userId);
  if (!playerId) return null;

  const { data: space, error: spaceError } = await admin.from("spaces").select("owner_player_id").eq("id", spaceId).maybeSingle();
  if (spaceError) throw new Error(spaceError.message);
  if (!space) return null;
  if (String(space.owner_player_id) === playerId) return "owner";

  const { data: member, error: memberError } = await admin
    .from("space_members")
    .select("role,status")
    .eq("space_id", spaceId)
    .eq("player_id", playerId)
    .eq("status", "active")
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  return member?.role ? String(member.role) : null;
}

export async function requireSpaceTeamReviewAccess(admin: AdminClient, userId: string, spaceId: string) {
  const role = await getSpaceTeamRole(admin, userId, spaceId);
  if (role !== "owner" && role !== "admin") {
    const error = new Error("No tenés permiso para revisar solicitudes de este espacio.") as Error & { status?: number; code?: string };
    error.status = 403;
    error.code = "SPACE_TEAM_FORBIDDEN";
    throw error;
  }
  return role;
}
