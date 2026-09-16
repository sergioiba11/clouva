import { NextRequest, NextResponse } from "next/server";
import { publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";
import { getMediaJob, syncVideoJob, toPublicMediaJob } from "@/lib/server/media-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { id } = await context.params;
    let job = await getMediaJob(admin, user.id, id);
    if (!job) return NextResponse.json({ error: "La creación no existe.", code: "job_not_found" }, { status: 404 });

    if (job.type === "video" && ["queued", "generating", "processing"].includes(job.status)) {
      job = await syncVideoJob(admin, job, {
        runwayApiKey: process.env.RUNWAY_API_KEY,
        geminiApiKey: process.env.GEMINI_API_KEY,
      });
    }

    return NextResponse.json({ job: toPublicMediaJob(job) });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
