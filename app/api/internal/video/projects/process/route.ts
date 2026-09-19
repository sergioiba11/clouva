import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/server/supabase";
import { processVideoProjectStep } from "@/lib/server/video-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const configured = (process.env.VIDEO_PROJECT_TASK_SECRET || process.env.CLOUVA_ASSET_IMPORT_WORKER_SECRET)?.trim();
  const supplied = request.headers.get("x-clouva-video-task-secret")?.trim();
  return Boolean(configured && supplied && configured === supplied);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({})) as { projectId?: string };
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    if (!/^[0-9a-f-]{36}$/i.test(projectId)) return NextResponse.json({ error: "projectId inválido" }, { status: 400 });
    const project = await processVideoProjectStep(createAdminSupabase(), projectId);
    return NextResponse.json({ ok: true, projectId: project.id, status: project.status, progress: project.progress });
  } catch (error) {
    console.error("[video-projects/process]", error);
    return NextResponse.json({ error: "No se pudo procesar el proyecto de video." }, { status: 500 });
  }
}
