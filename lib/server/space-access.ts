import type { SupabaseClient } from "@supabase/supabase-js";

export type SpaceAdminEligibility = {
  isVip: boolean;
  isGlobalAdmin: boolean;
  canAdministerSpaces: boolean;
};

function entitlementIsCurrent(row: Record<string, unknown>, now = Date.now()) {
  const startsAt = typeof row.valid_from === "string"
    ? row.valid_from
    : typeof row.starts_at === "string"
      ? row.starts_at
      : null;
  const endsAt = typeof row.valid_until === "string"
    ? row.valid_until
    : typeof row.expires_at === "string"
      ? row.expires_at
      : null;

  if (startsAt && new Date(startsAt).getTime() > now) return false;
  if (endsAt && new Date(endsAt).getTime() <= now) return false;
  return true;
}

export async function getSpaceAdminEligibility(args: {
  admin: SupabaseClient;
  userId: string;
}): Promise<SpaceAdminEligibility> {
  const [{ data: profile, error: profileError }, { data: entitlements, error: entitlementError }] = await Promise.all([
    args.admin.from("profiles").select("role").eq("id", args.userId).maybeSingle(),
    args.admin
      .from("user_entitlements")
      .select("tier,status,valid_from,valid_until,starts_at,expires_at")
      .eq("user_id", args.userId)
      .eq("tier", "vip")
      .eq("status", "active"),
  ]);

  if (profileError) throw new Error(profileError.message);
  if (entitlementError) throw new Error(entitlementError.message);

  const isGlobalAdmin = profile?.role === "admin";
  const isVip = (entitlements ?? []).some((row) => entitlementIsCurrent(row as Record<string, unknown>));
  return { isVip, isGlobalAdmin, canAdministerSpaces: isGlobalAdmin || isVip };
}

export async function requireSpaceAdminPlan(args: {
  admin: SupabaseClient;
  userId: string;
}) {
  const eligibility = await getSpaceAdminEligibility(args);
  if (eligibility.canAdministerSpaces) return eligibility;

  const error = new Error("CLOUVA VIP es necesario para crear y administrar espacios.") as Error & {
    status?: number;
    code?: string;
  };
  error.status = 403;
  error.code = "VIP_REQUIRED";
  throw error;
}
