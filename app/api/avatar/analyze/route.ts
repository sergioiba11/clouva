
import { NextRequest, NextResponse } from "next/server";
import {
  createAnalyzerJob,
  errorMessage,
  findActiveAnalyzerJob,
  persistPendingAnalyzerJob,
  recordAnalyzerJobExecution,
  requireUser,
  resolveOriginalAvatar,
} from "./_shared";
import { runAnalyzerJob } from "@/lib/cloud-run-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser(request);
    const avatar = await resolveOriginalAvatar(supabase, user.id);

    const activeJobId = await findActiveAnalyzerJob(supabase, user.id, avatar.avatarId);
    if (activeJobId) {
      return NextResponse.json({ jobId: activeJobId, pendingPersisted: true, reused: true });
    }

    const jobId = await createAnalyzerJob({
      supabase,
      userId: user.id,
      avatarId: avatar.avatarId,
      sourceRef: avatar.sourceRef,
      requestedRigProfile: "BODY_BASIC",
    });

    try {
      const executionName = await runAnalyzerJob(jobId);
      await recordAnalyzerJobExecution(supabase, jobId, executionName);
    } catch (cause) {
      await supabase
        .from("avatar_analyzer_jobs")
        .update({
          status: "failed",
          error_code: "CLOUD_RUN_TRIGGER_FAILED",
          error_message: errorMessage(cause).slice(0, 2000),
          finished_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      throw cause;
    }

    let pendingPersisted = false;
    if (avatar.avatarId) {
      try {
        await persistPendingAnalyzerJob({ supabase, userId: user.id, avatarId: avatar.avatarId, jobId });
        pendingPersisted = true;
      } catch (cause) {
        console.error("Avatar Analyzer pending job persistence failed", {
          jobId,
          cause: errorMessage(cause),
        });
      }
    }
    return NextResponse.json({ jobId, pendingPersisted });
  } catch (cause) {
    console.error("Avatar Analyzer kickoff failed", cause);
    return NextResponse.json({ error: errorMessage(cause) }, { status: 422 });
  }
}
