import type { SupabaseClient } from "@supabase/supabase-js";

const PLAYER_MANAGER_ROLES = new Set(["owner", "manager", "editor"]);
const STUDIO_MANAGER_ROLES = new Set(["owner", "admin", "manager", "editor"]);

// Centralized gate for every CLOUVA AI Profile (VIP) operation, for either
// subject -- mirrors requireStudioManager in studio-permissions.ts. Checks,
// in order: real VIP entitlement (tier + active + within its validity
// window), then that the caller actually administers this specific Player
// or Estudio. Never trust a client-sent id alone -- ownership is
// re-verified here on every call. Exactly one of playerId/studioId must be
// passed.
export async function requireActiveVipEntitlement(args: {
  admin: SupabaseClient;
  userId: string;
  playerId?: string;
  studioId?: string;
}) {
  if (!args.playerId && !args.studioId) throw new Error("Falta playerId o studioId.");
  const now = new Date().toISOString();

  const [
    { data: entitlement, error: entitlementError },
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
    args.admin.from("profiles").select("role").eq("id", args.userId).maybeSingle(),
  ]);
  if (entitlementError) throw new Error(entitlementError.message);
  if (profileError) throw new Error(profileError.message);

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

  if (args.playerId) {
    const [{ data: player, error: playerError }, { data: membership, error: membershipError }] = await Promise.all([
      args.admin.from("players").select("id,owner_user_id,slug,display_name").eq("id", args.playerId).maybeSingle(),
      args.admin.from("player_members").select("id,role,status").eq("player_id", args.playerId).eq("user_id", args.userId).eq("status", "active").maybeSingle(),
    ]);
    if (playerError) throw new Error(playerError.message);
    if (membershipError) throw new Error(membershipError.message);
    if (!player) {
      const error = new Error("El Player no existe.");
      (error as Error & { status?: number }).status = 404;
      throw error;
    }

    const role = player.owner_user_id === args.userId ? "owner" : membership?.role || (isAdmin ? "admin" : null);
    if (!role || (!PLAYER_MANAGER_ROLES.has(role) && role !== "admin")) {
      const error = new Error("No tenés permiso para administrar este Player.");
      (error as Error & { status?: number }).status = 403;
      throw error;
    }
    return { player, studio: null, entitlement, role };
  }

  const [{ data: studio, error: studioError }, { data: membership, error: membershipError }] = await Promise.all([
    args.admin.from("studios").select("id,owner_id,slug,name").eq("id", args.studioId).maybeSingle(),
    args.admin.from("studio_members").select("id,role,status").eq("studio_id", args.studioId).eq("profile_id", args.userId).eq("status", "active").maybeSingle(),
  ]);
  if (studioError) throw new Error(studioError.message);
  if (membershipError) throw new Error(membershipError.message);
  if (!studio) {
    const error = new Error("El Estudio no existe.");
    (error as Error & { status?: number }).status = 404;
    throw error;
  }

  const role = studio.owner_id === args.userId ? "owner" : membership?.role || (isAdmin ? "admin" : null);
  if (!role || (!STUDIO_MANAGER_ROLES.has(role) && role !== "admin")) {
    const error = new Error("No tenés permiso para administrar este Estudio.");
    (error as Error & { status?: number }).status = 403;
    throw error;
  }
  return { player: null, studio, entitlement, role };
}
