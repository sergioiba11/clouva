import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { resolveStudioForMembership } from "@/lib/server/studio-membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Free membership join, entered from the studio's own public page. Idempotent
// on purpose: re-clicking "Unirme gratis" (or the auth-redirect flow retrying
// after signup) never duplicates studio_fan_memberships -- (studio_id,
// user_id) is unique, and an existing paid membership is never downgraded by
// this route (it only reactivates status, never touches plan_id when a row
// already exists).
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug } = await params;
    const admin = createAdminSupabase();
    const studio = await resolveStudioForMembership(admin, slug);

    const { data: freePlan, error: planError } = await admin
      .from("studio_membership_plans")
      .select("id")
      .eq("studio_id", studio.id)
      .eq("is_free", true)
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (planError) throw new Error(planError.message);
    if (!freePlan) {
      const error = new Error("Este Estudio todavía no tiene una membresía gratuita.");
      (error as Error & { status?: number }).status = 404;
      throw error;
    }

    const { data: existing, error: existingError } = await admin
      .from("studio_fan_memberships")
      .select("id,status")
      .eq("studio_id", studio.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    if (existing) {
      if (existing.status !== "active") {
        const { error: updateError } = await admin
          .from("studio_fan_memberships")
          .update({ status: "active" })
          .eq("id", existing.id);
        if (updateError) throw new Error(updateError.message);
      }
      return NextResponse.json({ joined: true, studioSlug: studio.slug, reused: true });
    }

    const { error: insertError } = await admin.from("studio_fan_memberships").insert({
      studio_id: studio.id,
      user_id: user.id,
      plan_id: freePlan.id,
      status: "active",
      source: "direct",
    });
    if (insertError) throw new Error(insertError.message);

    return NextResponse.json({ joined: true, studioSlug: studio.slug, reused: false });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo completar la membresía.";
    return NextResponse.json({ error: message }, { status });
  }
}
