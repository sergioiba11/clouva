import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioManager } from "@/lib/server/studio-permissions";

const PLAYER_MANAGER_ROLES = new Set(["owner", "manager", "editor"]);

// One shared identity-generation pipeline, two product gates:
// - Player identity remains a CLOUVA VIP personal benefit.
// - Studio identity is included in the Studio's own active Studio OS plan.
// Ownership/permission is re-verified server-side for every call.
export async function requireActiveVipEntitlement(args: {
  admin: SupabaseClient;
  userId: string;
  playerId?: string;
  studioId?: string;
}) {
  if ((!args.playerId && !args.studioId) || (args.playerId && args.studioId)) {
    throw new Error("Elegí playerId o studioId, no ambos.");
  }

  if (args.studioId) {
    const permission = await requireStudioManager({
      admin: args.admin,
      userId: args.userId,
      studioId: args.studioId,
    });
    return {
      player: null,
      studio: permission.studio,
      entitlement: null,
      role: permission.role,
      productGate: "studio_os" as const,
    };
  }

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
    entitlement
    && (!starts || starts <= now)
    && (!expires || expires > now),
  );
  if (!vipActive && !isAdmin) {
    const error = new Error("Necesitás CLOUVA VIP activo para usar CLOUVA AI Profile en tu Player.");
    (error as Error & { status?: number }).status = 403;
    throw error;
  }

  const playerId = args.playerId as string;
  const [{ data: player, error: playerError }, { data: membership, error: membershipError }] = await Promise.all([
    args.admin.from("players").select("id,owner_user_id,slug,display_name").eq("id", playerId).maybeSingle(),
    args.admin.from("player_members").select("id,role,status").eq("player_id", playerId).eq("user_id", args.userId).eq("status", "active").maybeSingle(),
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

  return {
    player,
    studio: null,
    entitlement,
    role,
    productGate: "clouva_vip" as const,
  };
}
