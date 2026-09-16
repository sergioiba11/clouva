import { NextRequest, NextResponse } from "next/server";
import { getGeneration, publicClouAIMediaJob, syncVideoJob } from "@/lib/clouva-ai/media/generation-service";
import { publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { id } = await context.params;
    let job = await getGeneration(admin, user.id, id);
    if (!job) return NextResponse.json({ error: "La generación no existe.", code: "job_not_found" }, { status: 404 });
    if (job.type === "video" && ["submitted", "generating", "processing"].includes(job.status)) {
      job = await syncVideoJob(admin, user.id, job);
    }
    const { data: outputs } = await admin.from("clouai_generation_outputs").select("id,output_type,storage_path,public_url,mime_type,width,height,duration_seconds,library_bucket,library_path,metadata_json,created_at")
      .eq("generation_id", id).eq("user_id", user.id).order("created_at", { ascending: true });
    return NextResponse.json({ job: publicClouAIMediaJob(job), outputs: outputs ?? [] });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
