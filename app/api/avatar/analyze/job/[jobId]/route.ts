
import { NextRequest, NextResponse } from "next/server";
import {
  errorMessage,
  getAnalyzerJobForUser,
  persistAnalyzerJobError,
  persistCompletedAnalyzerJob,
  requireUser,
  toWorkerJobStatus,
} from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const JOB_ID_PATTERN = /^[a-f0-9]{32}$/;

export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { supabase, user } = await requireUser(request);
    const { jobId } = await params;
    if (!JOB_ID_PATTERN.test(jobId)) {
      return NextResponse.json({ error: "jobId inválido" }, { status: 400 });
    }

    const row = await getAnalyzerJobForUser(supabase, user.id, jobId);
    if (!row) {
      return NextResponse.json({ error: "Job no encontrado", code: "ANALYZER_JOB_NOT_FOUND" }, { status: 404 });
    }
    const job = toWorkerJobStatus(row);

    if (job.status === "done" && job.runId && row.avatar_id) {
      await persistCompletedAnalyzerJob({
        supabase,
        userId: user.id,
        avatarId: row.avatar_id,
        jobId,
        runId: job.runId,
        summary: job.summary || {},
      }).catch((cause) => {
        console.error("Avatar Analyzer V4 completion persistence failed", {
          jobId,
          runId: job.runId,
          cause: errorMessage(cause),
        });
      });
    } else if (job.status === "error" && row.avatar_id) {
      await persistAnalyzerJobError({
        supabase,
        userId: user.id,
        avatarId: row.avatar_id,
        jobId,
        error: job.detail || "No se pudo completar el análisis",
      }).catch((cause) => {
        console.error("Avatar Analyzer V4 error persistence failed", { jobId, cause: errorMessage(cause) });
      });
    }

    return NextResponse.json(job, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("Avatar Analyzer job status failed", cause);
    return NextResponse.json({ error: errorMessage(cause) }, { status: 422 });
  }
}
