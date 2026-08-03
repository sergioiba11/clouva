import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { resolveStudioForMembership } from "@/lib/server/studio-membership";
import { activateStudioMembership } from "@/lib/server/studio-memberships";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Platform-admin-only manual grant. It does not fabricate a payment, but it
// still uses the same canonical transaction as free and paid memberships so
// the public Player role can never drift from the membership record.
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();

    const { data: profile, error: profileError } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profileError) throw new Error(profileError.message);
    if (profile?.role !== "admin") {
      const error = new Error("Solo el admin de CLOUVA puede omitir la suscripción.");
      (error as Error & { status?: number }).status = 403;
      throw error;
    }

    const { slug } = await params;
    const studio = await resolveStudioForMembership(admin, slug);
    const body = (await request.json().catch(() => ({}))) as { planId?: unknown };
    const planId = typeof body.planId === "string" ? body.planId : "";
    if (!planId) return NextResponse.json({ error: "Falta elegir un plan." }, { status: 400 });

    const { data: plan, error: planError } = await admin
      .from("studio_membership_plans")
      .select("id")
      .eq("id", planId)
      .eq("studio_id", studio.id)
      .eq("is_active", true)
      .maybeSingle();
    if (planError) throw new Error(planError.message);
    if (!plan) return NextResponse.json({ error: "Ese plan no está disponible." }, { status: 404 });

    const activation = await activateStudioMembership({
      admin,
      userId: user.id,
      studioId: studio.id,
      planId: plan.id,
      source: "admin_bypass",
      forceActive: true,
      returnPath: `/studios/${studio.slug}?joined=1`,
    });

    return NextResponse.json({
      joined: true,
      studioSlug: studio.slug,
      publicRole: activation.publicRole,
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
