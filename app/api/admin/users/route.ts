import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(request: NextRequest) {
  const { user } = await requireUser(request);
  const admin = createAdminSupabase();
  const { data: profile, error } = await admin
    .from("profiles")
    .select("role,role_v2")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (profile?.role !== "admin" && profile?.role_v2 !== "admin") {
    const forbidden = new Error("No autorizado.");
    (forbidden as Error & { status?: number }).status = 403;
    throw forbidden;
  }
  return admin;
}

export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    const authUsers = [];
    const perPage = 1000;

    for (let page = 1; ; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) throw new Error(error.message);
      authUsers.push(...data.users);
      if (data.users.length < perPage) break;
    }

    const userIds = authUsers.map((user) => user.id);
    const [{ data: profiles, error: profilesError }, { data: players, error: playersError }, { data: entitlements, error: entitlementsError }] = await Promise.all([
      userIds.length
        ? admin.from("profiles").select("id,full_name,display_name,avatar_url,is_vip,is_blocked,clouva_id,username,role,role_v2,onboarding_status,onboarding_completed_at,email").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? admin.from("players").select("id,owner_user_id,display_name,slug,is_published,publication_status,created_at").in("owner_user_id", userIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length
        ? admin.from("user_entitlements").select("user_id,status,source,starts_at,expires_at,created_at").eq("tier", "vip").in("user_id", userIds).order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (profilesError) throw new Error(profilesError.message);
    if (playersError) throw new Error(playersError.message);
    if (entitlementsError) throw new Error(entitlementsError.message);

    const profileById = new Map((profiles ?? []).map((profile) => [profile.id as string, profile]));
    const playerByOwner = new Map((players ?? []).map((player) => [player.owner_user_id as string, player]));
    const latestEntitlementByUser = new Map<string, Record<string, unknown>>();
    for (const entitlement of entitlements ?? []) {
      const userId = entitlement.user_id as string;
      if (!latestEntitlementByUser.has(userId)) latestEntitlementByUser.set(userId, entitlement);
    }

    const users = authUsers
      .map((authUser) => {
        const profile = profileById.get(authUser.id) ?? null;
        const player = playerByOwner.get(authUser.id) ?? null;
        const entitlement = latestEntitlementByUser.get(authUser.id) ?? null;
        const fallbackName =
          (authUser.user_metadata?.full_name as string | undefined) ??
          (authUser.user_metadata?.name as string | undefined) ??
          authUser.email?.split("@")[0] ??
          "Usuario";

        return {
          id: authUser.id,
          email: authUser.email ?? profile?.email ?? null,
          created_at: authUser.created_at,
          last_sign_in_at: authUser.last_sign_in_at ?? null,
          confirmed_at: authUser.confirmed_at ?? null,
          providers: Array.isArray(authUser.app_metadata?.providers) ? authUser.app_metadata.providers : [],
          full_name: profile?.full_name ?? profile?.display_name ?? fallbackName,
          avatar_url: profile?.avatar_url ?? null,
          is_vip: profile?.is_vip ?? false,
          is_blocked: profile?.is_blocked ?? false,
          clouva_id: profile?.clouva_id ?? null,
          username: profile?.username ?? null,
          role: profile?.role_v2 ?? profile?.role ?? "cliente",
          onboarding_status: profile?.onboarding_status ?? (player ? (player.is_published ? "published" : "player_created") : "pending"),
          onboarding_completed_at: profile?.onboarding_completed_at ?? null,
          player,
          vip_entitlement: entitlement,
        };
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return NextResponse.json({ users, total: users.length });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudieron cargar los usuarios.";
    return NextResponse.json({ error: message }, { status });
  }
}
