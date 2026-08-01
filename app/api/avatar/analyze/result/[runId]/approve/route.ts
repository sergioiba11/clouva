import { NextRequest, NextResponse } from "next/server";
import { approveAnalyzerRun, errorMessage, requireUser } from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUN_ID_PATTERN = /^[a-f0-9]{32}$/;

/** Confirmación manual del laboratorio holográfico: exige que el usuario
 * revise el resultado ya persistido antes de poder avanzar. No dispara
 * ningún análisis nuevo ni toca Blender -- solo marca `manuallyApproved` en
 * el job real (avatar_analyzer_jobs.summary). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const { supabase, user } = await requireUser(request);
    const { runId } = await params;
    if (!RUN_ID_PATTERN.test(runId)) {
      return NextResponse.json({ error: "runId inválido" }, { status: 400 });
    }
    const summary = await approveAnalyzerRun(supabase, user.id, runId);
    return NextResponse.json(
      { manuallyApproved: true, manuallyApprovedAt: summary.manuallyApprovedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    return NextResponse.json({ error: errorMessage(cause) }, { status: 422 });
  }
}
