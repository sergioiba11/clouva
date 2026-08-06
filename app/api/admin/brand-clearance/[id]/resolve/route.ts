import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_DECISIONS = [
  "clear",
  "review_required",
  "blocked_external_name_conflict",
  "blocked_external_visual_conflict",
  "blocked_combined_conflict",
] as const;
type ManualDecision = (typeof VALID_DECISIONS)[number];

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();

    const { data: profile, error: profileError } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profileError) throw new Error(profileError.message);
    if (profile?.role !== "admin") return NextResponse.json({ error: "Solo un administrador puede resolver el clearance." }, { status: 403 });

    const body = (await request.json().catch(() => ({}))) as { decision?: string; note?: string };
    if (!body.decision || !(VALID_DECISIONS as readonly string[]).includes(body.decision)) {
      return NextResponse.json({ error: "Decisión de clearance inválida." }, { status: 400 });
    }
    const decision = body.decision as ManualDecision;
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
    if (!note) return NextResponse.json({ error: "La revisión manual requiere una nota de auditoría." }, { status: 400 });

    const { data: check, error: checkError } = await admin
      .from("brand_clearance_checks")
      .select("id,brand_asset_version_id,status,decision_reasons,internal_matches")
      .eq("id", id)
      .maybeSingle();
    if (checkError) throw new Error(checkError.message);
    if (!check) return NextResponse.json({ error: "El control de clearance no existe." }, { status: 404 });

    if (check.status === "blocked_internal_duplicate" && decision === "clear") {
      return NextResponse.json({ error: "Un duplicado interno bloqueado no puede aprobarse mediante revisión externa manual." }, { status: 409 });
    }

    const previousReasons = Array.isArray(check.decision_reasons) ? check.decision_reasons.filter((entry): entry is string => typeof entry === "string") : [];
    const decisionReasons = [...previousReasons, `Revisión manual por ${user.id}: ${note}`];
    const reviewedAt = new Date().toISOString();

    const { error: updateCheckError } = await admin
      .from("brand_clearance_checks")
      .update({
        status: decision,
        manual_decision: decision,
        review_note: note,
        reviewed_by: user.id,
        reviewed_at: reviewedAt,
        decision_reasons: decisionReasons,
      })
      .eq("id", id);
    if (updateCheckError) throw new Error(updateCheckError.message);

    const { error: updateVersionError } = await admin
      .from("brand_asset_versions")
      .update({ clearance_status: decision, clearance_check_id: id })
      .eq("id", check.brand_asset_version_id);
    if (updateVersionError) throw new Error(updateVersionError.message);

    return NextResponse.json({
      clearance: {
        id,
        brandAssetVersionId: check.brand_asset_version_id,
        status: decision,
        reviewedBy: user.id,
        reviewedAt,
        note,
      },
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo resolver el clearance.";
    return NextResponse.json({ error: message }, { status });
  }
}
