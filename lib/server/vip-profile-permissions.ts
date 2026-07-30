import type { SupabaseClient } from "@supabase/supabase-js";

const MANAGER_ROLES = new Set(["owner", "manager", "editor"]);

// Centralized gate for every CLOUVA AI Profile (VIP) operation -- mirrors
// requireStudioManager in studio-permissions.ts. Checks, in order: real VIP
// entitlement (tier + active + within its validity window), then that the
// caller actually administers this specific Player. Never trust a client-sent
// player_id alone -- ownership is re-verified here on every call.
export async function requireActiveVipEntitlement(args: {
  admin: SupabaseClient;
  userId: string;
  playerId: string;
}) {
  const now = new Date().toISOString();
  const [
    { data: entitlement, error: entitlementError },
    { data: player, error: playerError },
    { data: membership, error: membershipError },
    { data: profile, error: profileError },
  ] = await Promise.all([
    args.admin
      .from("user_entitlements")
      .select("id,tier,status,valid_from,valid_until,starts_at,expires_at")
      .eq("user_id", args.userId)
      .eq("tier", "vip")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    args.admin.from("players").select("id,owner_user_id,slug,display_name").eq("id", args.playerId).maybeSingle(),
    args.admin
      .from("player_members")
      .select("id,role,status")
      .eq("player_id", args.playerId)
      .eq("user_id", args.userId)
      .eq("status", "active")
      .maybeSingle(),
    args.admin.from("profiles").select("role").eq("id", args.userId).maybeSingle(),
  ]);

  for (const error of [entitlementError, playerError, membershipError, profileError]) {
    if (error) throw new Error(error.message);
  }
  if (!player) {
    const error = new Error("El Player no existe.");
    (error as Error & { status?: number }).status = 404;
    throw error;
  }

  const isAdmin = profile?.role === "admin";
  const starts = entitlement?.valid_from || entitlement?.starts_at;
  const expires = entitlement?.valid_until || entitlement?.expires_at;
  const vipActive = Boolean(
    entitlement &&
    (!starts || starts <= now) &&
    (!expires || expires > now),
  );
  if (!vipActive && !isAdmin) {
    const error = new Error("Necesitás CLOUVA VIP activo para usar CLOUVA AI Profile.");
    (error as Error & { status?: number }).status = 403;
    throw error;
  }

  const role = player.owner_user_id === args.userId
    ? "owner"
    : membership?.role || (isAdmin ? "admin" : null);
  if (!role || (!MANAGER_ROLES.has(role) && role !== "admin")) {
    const error = new Error("No tenés permiso para administrar este Player.");
    (error as Error & { status?: number }).status = 403;
    throw error;
  }

  return { player, entitlement, role };
}
