import type { SupabaseClient } from "@supabase/supabase-js";

const MANAGER_ROLES = new Set(["owner", "admin", "manager", "editor"]);

export async function requireStudioManager(args: {
  admin: SupabaseClient;
  userId: string;
  studioId: string;
}) {
  const now = new Date().toISOString();
  const [{ data: entitlement, error: entitlementError }, { data: studio, error: studioError }, { data: membership, error: membershipError }, { data: profile, error: profileError }] = await Promise.all([
    args.admin
      .from("user_entitlements")
      .select("id,tier,status,valid_from,valid_until,starts_at,expires_at")
      .eq("user_id", args.userId)
      .eq("tier", "vip")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    args.admin.from("studios").select("id,owner_id,name,slug").eq("id", args.studioId).maybeSingle(),
    args.admin.from("studio_members").select("id,role,status").eq("studio_id", args.studioId).eq("profile_id", args.userId).eq("status", "active").maybeSingle(),
    args.admin.from("profiles").select("role").eq("id", args.userId).maybeSingle(),
  ]);

  for (const error of [entitlementError, studioError, membershipError, profileError]) {
    if (error) throw new Error(error.message);
  }
  if (!studio) throw new Error("El Estudio no existe.");

  const starts = entitlement?.valid_from || entitlement?.starts_at;
  const expires = entitlement?.valid_until || entitlement?.expires_at;
  const vipActive = Boolean(
    entitlement &&
    (!starts || starts <= now) &&
    (!expires || expires > now),
  );
  if (!vipActive) {
    const error = new Error("Necesitás CLOUVA VIP activo para administrar Estudios.");
    (error as Error & { status?: number }).status = 403;
    throw error;
  }

  const role = studio.owner_id === args.userId
    ? "owner"
    : membership?.role || (profile?.role === "admin" ? "admin" : null);
  if (!role || !MANAGER_ROLES.has(role)) {
    const error = new Error("No tenés permiso para administrar este Estudio.");
    (error as Error & { status?: number }).status = 403;
    throw error;
  }

  return { studio, role, entitlement };
}
