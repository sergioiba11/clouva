import { NextRequest, NextResponse } from "next/server";
import { publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";
import { getVideoProject, listVideoProjectJobs, toPublicVideoProject, toPublicVideoProjectJob } from "@/lib/server/video-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { projectId } = await context.params;
    const project = await getVideoProject(admin, projectId, user.id);
    if (!project) return NextResponse.json({ error: "El proyecto no existe.", code: "project_not_found" }, { status: 404 });
    const clips = await listVideoProjectJobs(admin, project.id);
    return NextResponse.json({
      project: toPublicVideoProject(project),
      clips: clips.map(toPublicVideoProjectJob),
    });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
