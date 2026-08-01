import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { resolveStudioForMembership } from "@/lib/server/studio-membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Platform-admin-only shortcut: join any plan (free or paid) without going
// through Mercado Pago. No billing_products/prices/subscriptions touched --
// this is a manual grant (source "admin_bypass"), not a real payment.
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

    const { error: upsertError } = await admin
      .from("studio_fan_memberships")
      .upsert(
        { studio_id: studio.id, user_id: user.id, plan_id: plan.id, status: "active", source: "admin_bypass" },
        { onConflict: "studio_id,user_id" },
      );
    if (upsertError) throw new Error(upsertError.message);

    return NextResponse.json({ joined: true, studioSlug: studio.slug });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo completar la membresía.";
    return NextResponse.json({ error: message }, { status });
  }
}
