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

    if (job.type === "video" && ["generating", "processing"].includes(job.status)) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY no está configurada.", code: "missing_api_key" }, { status: 500 });
      job = await syncVideoJob(admin, job, apiKey);
    }

    return NextResponse.json({ job: toPublicMediaJob(job) });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
