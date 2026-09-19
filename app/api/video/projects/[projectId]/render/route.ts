import { NextRequest, NextResponse } from "next/server";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";
import {
  getVideoProject,
  listVideoProjectJobs,
  startProjectRender,
  toPublicVideoProject,
  type VideoProjectRow,
} from "@/lib/server/video-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { projectId } = await context.params;
    const project = await getVideoProject(admin, projectId, user.id);
    if (!project) return NextResponse.json({ error: "El proyecto no existe.", code: "project_not_found" }, { status: 404 });
    return NextResponse.json({ project: toPublicVideoProject(project) });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { projectId } = await context.params;
    const project = await getVideoProject(admin, projectId, user.id);
    if (!project) return NextResponse.json({ error: "El proyecto no existe.", code: "project_not_found" }, { status: 404 });
    const jobs = await listVideoProjectJobs(admin, project.id);
    if (!jobs.length || jobs.some((job) => job.status !== "completed")) {
      throw new MediaApiError("Todavía faltan clips por completar.", 409, "clips_incomplete");
    }
    const rendered = await startProjectRender(admin, project);
    return NextResponse.json({ project: toPublicVideoProject(rendered as VideoProjectRow) }, { status: 202 });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
