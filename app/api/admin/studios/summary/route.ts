import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cross-studio overview for CLOUVA's own admin, surfaced from La Matrix
// (MatrixAdminOverview.tsx) instead of only inside the separate /admin
// section. Admin-only: unlike requireStudioManager, this has nothing to do
// with owning a specific studio -- it's a platform-wide read.
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();

    const { data: profile, error: profileError } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profileError) throw new Error(profileError.message);
    if (profile?.role !== "admin") {
      const error = new Error("No tenés permiso para ver esto.");
      (error as Error & { status?: number }).status = 403;
      throw error;
    }

    const { data: studios, error: studiosError } = await admin
      .from("studios")
      .select("id,slug,name,is_published")
      .order("name");
    if (studiosError) throw new Error(studiosError.message);

    const studioIds = (studios ?? []).map((studio) => studio.id);
    const [membersResult, plansResult] = studioIds.length
      ? await Promise.all([
          admin.from("studio_fan_memberships").select("studio_id,status,plan:studio_membership_plans(is_free)").in("studio_id", studioIds),
          admin.from("studio_membership_plans").select("studio_id,is_active").in("studio_id", studioIds),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (membersResult.error) throw new Error(membersResult.error.message);
    if (plansResult.error) throw new Error(plansResult.error.message);

    const summaries = (studios ?? []).map((studio) => {
      const members = (membersResult.data ?? []).filter((row) => row.studio_id === studio.id);
      const activeMembers = members.filter((row) => row.status === "active");
      const payingMembers = activeMembers.filter((row) => {
        const plan = row.plan as unknown as { is_free: boolean } | null;
        return plan && !plan.is_free;
      });
      const activePlans = (plansResult.data ?? []).filter((row) => row.studio_id === studio.id && row.is_active);
      return {
        id: studio.id,
        slug: studio.slug,
        name: studio.name,
        isPublished: studio.is_published,
        membersActive: activeMembers.length,
        membersPaying: payingMembers.length,
        activePlans: activePlans.length,
      };
    });

    return NextResponse.json({ studios: summaries });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo cargar el resumen de Estudios.";
    return NextResponse.json({ error: message }, { status });
  }
}
