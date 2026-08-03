import type { SupabaseClient } from "@supabase/supabase-js";

const MANAGER_ROLES = new Set(["owner", "admin", "manager", "editor", "finance", "bookings", "support"]);
const ACTIVE_STUDIO_OS = new Set(["active", "grace", "legacy_active"]);

export async function requireStudioManager(args: {
  admin: SupabaseClient;
  userId: string;
  studioId: string;
}) {
  const [{ data: studio, error: studioError }, { data: membership, error: membershipError }, { data: profile, error: profileError }] = await Promise.all([
    args.admin
      .from("studios")
      .select("id,owner_id,name,slug,studio_os_status,studio_os_expires_at,studio_os_subscription_id")
      .eq("id", args.studioId)
      .maybeSingle(),
    args.admin
      .from("studio_members")
      .select("id,role,status")
      .eq("studio_id", args.studioId)
      .eq("profile_id", args.userId)
      .eq("status", "active")
      .maybeSingle(),
    args.admin.from("profiles").select("role").eq("id", args.userId).maybeSingle(),
  ]);

  for (const error of [studioError, membershipError, profileError]) {
    if (error) throw new Error(error.message);
  }
  if (!studio) {
    const error = new Error("El Estudio no existe.");
    (error as Error & { status?: number }).status = 404;
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

  const expiresAt = studio.studio_os_expires_at ? new Date(studio.studio_os_expires_at) : null;
  const studioOsActive = ACTIVE_STUDIO_OS.has(studio.studio_os_status)
    && (!expiresAt || expiresAt > new Date());
  if (!studioOsActive) {
    const error = new Error("Studio OS no está activo para este Estudio.");
    (error as Error & { status?: number; code?: string }).status = 402;
    (error as Error & { status?: number; code?: string }).code = "STUDIO_OS_REQUIRED";
    throw error;
  }

  return { studio, role, studioOsActive: true as const };
}
