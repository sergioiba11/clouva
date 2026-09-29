import { NextRequest, NextResponse } from "next/server";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";
import { getVideoEnhanceJob, toPublicVideoEnhance } from "@/lib/server/video-enhance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { jobId } = await context.params;
    const job = await getVideoEnhanceJob(admin, jobId, user.id);
    if (!job) throw new MediaApiError("El trabajo no existe.", 404, "enhance_not_found");
    return NextResponse.json({ job: toPublicVideoEnhance(job) });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
