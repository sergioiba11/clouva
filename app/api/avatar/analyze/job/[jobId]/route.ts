import { NextRequest, NextResponse } from "next/server";
import { errorMessage, requireUser, resolveOriginalAvatar, workerBaseUrlAndToken } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const JOB_ID_PATTERN = /^[a-f0-9]{32}$/;

type WorkerJobStatus = {
  status: "pending" | "done" | "error";
  runId?: string;
  summary?: Record<string, unknown>;
  detail?: string;
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const { supabase, user } = await requireUser(request);
    const { jobId } = await params;
    if (!JOB_ID_PATTERN.test(jobId)) {
      return NextResponse.json({ error: "jobId inválido" }, { status: 400 });
    }
    const { workerBaseUrl, workerToken } = workerBaseUrlAndToken();

    const response = await fetch(`${workerBaseUrl}/avatar/analyze-v4/job/${jobId}`, {
      headers: workerToken ? { Authorization: `Bearer ${workerToken}` } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(15 * 1000),
    });
    if (response.status === 404) {
      return NextResponse.json({ error: "Job no encontrado" }, { status: 404 });
    }
    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      throw new Error(`No se pudo consultar el estado del análisis (${response.status})${raw ? `: ${raw.slice(0, 800)}` : ""}`);
    }
    const job = await response.json() as WorkerJobStatus;

    if (job.status === "done" && job.runId && /^[a-f0-9]{32}$/.test(job.runId)) {
      const summary = job.summary || {};
      const avatar = await resolveOriginalAvatar(supabase, user.id).catch(() => null);
      if (avatar?.avatarId) {
        const { error: metadataError } = await supabase
          .from("user_avatars")
          .update({
            metadata: {
              ...avatar.metadata,
              avatar_analyzer_v4: {
                runId: job.runId,
                analyzerVersion: String(summary.analyzerVersion ?? "clouva-avatar-analyzer-v4.1"),
                mapVersion: "clouva-anatomical-map-v4.1",
                sourceSha256: String(summary.sourceSha256 ?? ""),
                status: String(summary.status ?? "needs_review"),
                requestedRigProfile: String(summary.requestedRigProfile ?? "BODY_BASIC"),
                updatedAt: new Date().toISOString(),
              },
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", avatar.avatarId)
          .eq("user_id", user.id);
        if (metadataError) {
          console.error("Avatar Analyzer V4 metadata persistence failed", metadataError);
        }
      }
    }

    return NextResponse.json(job);
  } catch (cause) {
    console.error("Avatar Analyzer job status failed", cause);
    return NextResponse.json({ error: errorMessage(cause) }, { status: 422 });
  }
}
