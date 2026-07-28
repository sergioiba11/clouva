
import { NextRequest, NextResponse } from "next/server";
import {
  errorMessage,
  findAvatarForAnalyzerJob,
  persistCancelledAnalyzerJob,
  requireUser,
  workerBaseUrlAndToken,
  workerError,
} from "../../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const JOB_ID_PATTERN = /^[a-f0-9]{32}$/;

type WorkerJobStatus = {
  status: "pending" | "done" | "error" | "cancelled";
  runId?: string;
  summary?: Record<string, unknown>;
  detail?: string;
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { supabase, user } = await requireUser(request);
    const { jobId } = await params;
    if (!JOB_ID_PATTERN.test(jobId)) {
      return NextResponse.json({ error: "jobId inválido" }, { status: 400 });
    }
    const { workerBaseUrl, workerToken } = workerBaseUrlAndToken();

    const response = await fetch(`${workerBaseUrl}/avatar/analyze-v4/job/${jobId}/cancel`, {
      method: "POST",
      headers: workerToken ? { Authorization: `Bearer ${workerToken}` } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(20 * 1000),
    });
    if (response.status === 404) {
      return NextResponse.json({ error: "Job no encontrado", code: "ANALYZER_JOB_NOT_FOUND" }, { status: 404 });
    }
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new Error(
        `No se pudo cancelar el análisis (${response.status})${raw ? `: ${workerError(raw).slice(0, 800)}` : ""}`,
      );
    }
    const job = await response.json() as WorkerJobStatus;

    const avatar = await findAvatarForAnalyzerJob(supabase, user.id, jobId).catch(() => null);
    if (avatar) {
      await persistCancelledAnalyzerJob({
        supabase,
        userId: user.id,
        avatarId: avatar.avatarId,
        jobId,
      }).catch((cause) => {
        console.error("Avatar Analyzer V4 cancel persistence failed", { jobId, cause: errorMessage(cause) });
      });
    }

    return NextResponse.json(job, { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    console.error("Avatar Analyzer job cancel failed", cause);
    return NextResponse.json({ error: errorMessage(cause) }, { status: 422 });
  }
}
