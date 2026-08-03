import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { resolveStudioForMembership } from "@/lib/server/studio-membership";
import { activateStudioMembership } from "@/lib/server/studio-memberships";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Free membership join. The database RPC owns the transaction that stores the
// membership and projects the public Player role into player_studios. A retry
// is idempotent because both relations have canonical unique constraints.
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug } = await params;
    const admin = createAdminSupabase();
    const studio = await resolveStudioForMembership(admin, slug);
    const body = (await request.json().catch(() => ({}))) as { planId?: unknown };
    const requestedPlanId = typeof body.planId === "string" ? body.planId : null;

    let planQuery = admin
      .from("studio_membership_plans")
      .select("id")
      .eq("studio_id", studio.id)
      .eq("is_free", true)
      .eq("is_active", true)
      .eq("is_public", true);
    if (requestedPlanId) planQuery = planQuery.eq("id", requestedPlanId);

    const { data: freePlan, error: planError } = await planQuery
      .order("display_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (planError) throw new Error(planError.message);
    if (!freePlan) {
      const error = new Error("Ese plan gratuito no está disponible.");
      (error as Error & { status?: number }).status = 404;
      throw error;
    }

    const activation = await activateStudioMembership({
      admin,
      userId: user.id,
      studioId: studio.id,
      planId: freePlan.id,
      source: "direct",
      returnPath: `/studios/${studio.slug}?joined=1`,
    });

    return NextResponse.json({
      joined: activation.status === "active",
      membershipStatus: activation.status,
      studioSlug: studio.slug,
      publicRole: activation.publicRole,
      area: activation.area,
      needsPlayer: activation.needsPlayer,
      redirectTo: activation.needsPlayer
        ? `/onboarding/identity?intent=studio_join&studio=${encodeURIComponent(studio.slug)}`
        : `/studios/${studio.slug}?joined=1`,
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo completar la membresía.";
    return NextResponse.json({ error: message }, { status });
  }
}
