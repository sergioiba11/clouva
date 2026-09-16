import { NextRequest, NextResponse } from "next/server";
import { CLOUAI_MEDIA_JOB_COLUMNS, publicClouAIMediaJob } from "@/lib/clouva-ai/media/generation-service";
import { publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 24, 1), 60);
    const type = url.searchParams.get("type");
    let query = admin.from("media_generation_jobs").select(CLOUAI_MEDIA_JOB_COLUMNS).eq("user_id", user.id).eq("provider", "google-cloud").order("created_at", { ascending: false }).limit(limit);
    if (type === "image" || type === "video") query = query.eq("type", type);
    const { data, error } = await query;
    if (error) throw new Error("No se pudo cargar el historial multimedia.");
    return NextResponse.json({ items: (data ?? []).map((row) => publicClouAIMediaJob(row as never)) });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
