
import { NextRequest, NextResponse } from "next/server";
import {
  errorMessage,
  persistCancelledAnalyzerJob,
  requestAnalyzerJobCancellation,
  requireUser,
  toWorkerJobStatus,
} from "../../../_shared";
import { cancelAnalyzerExecution } from "@/lib/cloud-run-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const JOB_ID_PATTERN = /^[a-f0-9]{32}$/;

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { supabase, user } = await requireUser(request);
    const { jobId } = await params;
    if (!JOB_ID_PATTERN.test(jobId)) {
      return NextResponse.json({ error: "jobId inválido" }, { status: 400 });
    }

    const row = await requestAnalyzerJobCancellation(supabase, user.id, jobId);
    if (!row) {
      return NextResponse.json({ error: "Job no encontrado", code: "ANALYZER_JOB_NOT_FOUND" }, { status: 404 });
    }

    if (row.status === "cancel_requested" && row.cloud_run_execution) {
      await cancelAnalyzerExecution(row.cloud_run_execution).catch((cause) => {
        // The entrypoint's own SIGTERM handler and next poll will still settle
        // this into a terminal state -- don't fail the request over a
        // best-effort early cancel signal.
        console.error("Avatar Analyzer Cloud Run execution cancel failed", { jobId, cause: errorMessage(cause) });
      });
    }

    if (row.avatar_id) {
      await persistCancelledAnalyzerJob({
        supabase,
        userId: user.id,
        avatarId: row.avatar_id,
        jobId,
      }).catch((cause) => {
        console.error("Avatar Analyzer V4 cancel persistence failed", { jobId, cause: errorMessage(cause) });
      });
    }

    return NextResponse.json(toWorkerJobStatus(row), { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("Avatar Analyzer job cancel failed", cause);
    return NextResponse.json({ error: errorMessage(cause) }, { status: 422 });
  }
}
