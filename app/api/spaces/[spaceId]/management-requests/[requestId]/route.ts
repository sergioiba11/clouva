import { NextRequest, NextResponse } from "next/server";
import { requireSpaceTeamReviewAccess } from "@/lib/server/space-team-access";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ spaceId: string; requestId: string }> },
) {
  try {
    const { user } = await requireUser(request);
    const { spaceId, requestId } = await params;
    const body = (await request.json().catch(() => ({}))) as { decision?: unknown; decisionMessage?: unknown };
    const decision = typeof body.decision === "string" ? body.decision.trim().toLowerCase() : "";
    if (decision !== "approved" && decision !== "rejected") {
      return NextResponse.json({ error: "Decisión inválida." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    await requireSpaceTeamReviewAccess(admin, user.id, spaceId);
    const { data: existing, error: existingError } = await admin
      .from("space_management_requests")
      .select("id,space_id,status")
      .eq("id", requestId)
      .eq("space_id", spaceId)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (!existing) return NextResponse.json({ error: "Solicitud inexistente." }, { status: 404 });

    const { data, error } = await admin.rpc("review_space_management_request", {
      p_request_id: requestId,
      p_reviewer_user_id: user.id,
      p_decision: decision,
      p_decision_message: typeof body.decisionMessage === "string" ? body.decisionMessage.trim().slice(0, 2000) || null : null,
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ result: data });
  } catch (error) {
    const typed = error as Error & { status?: number; code?: string };
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo revisar la solicitud.", ...(typed.code ? { code: typed.code } : {}) },
      { status: typed.status ?? (isAuthError(error) ? 401 : 500) },
    );
  }
}
