import { NextRequest, NextResponse } from "next/server";
import { VIDEO_QUALITY_CONFIG, isVideoAspectRatio, isVideoQuality, type VideoQuality } from "@/lib/media-generation-config";
import { MediaApiError, publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";
import { VIDEO_PROJECT_COLUMNS, toPublicVideoProject, type VideoProjectRow } from "@/lib/server/video-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { data, error } = await admin
      .from("video_projects")
      .select(VIDEO_PROJECT_COLUMNS)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new MediaApiError("No se pudieron cargar los proyectos de video.", 500, "project_list_failed");
    return NextResponse.json({ projects: (data ?? []).map((row) => toPublicVideoProject(row as unknown as VideoProjectRow)) });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 160) : "";
    if (!title) throw new MediaApiError("Poné un nombre al proyecto.", 400, "title_required");

    const quality: VideoQuality = isVideoQuality(body.quality) ? body.quality : "fast";
    const aspectRatio = isVideoAspectRatio(body.aspectRatio) ? body.aspectRatio : "16:9";
    const targetDurationSeconds = Math.max(4, Math.min(7200, Math.ceil(Number(body.targetDurationSeconds) || 8)));
    const projectMode = body.projectMode === "visualizer" ? "visualizer" : "video";
    const visualizerReactivity = Math.max(0.25, Math.min(2, Number(body.visualizerReactivity) || 1));
    const config = VIDEO_QUALITY_CONFIG[quality];

    const { data, error } = await admin.from("video_projects").insert({
      user_id: user.id,
      title,
      description: typeof body.description === "string" ? body.description.trim().slice(0, 2000) || null : null,
      master_prompt: typeof body.masterPrompt === "string" ? body.masterPrompt.trim().slice(0, 4000) : "",
      style_prompt: typeof body.stylePrompt === "string" ? body.stylePrompt.trim().slice(0, 4000) : "",
      provider: "google_vertex_ai",
      model: config.model,
      quality,
      aspect_ratio: aspectRatio,
      target_duration_seconds: targetDurationSeconds,
      maintain_style: body.maintainStyle !== false,
      maintain_character: body.maintainCharacter !== false,
      use_frame_continuity: body.useFrameContinuity !== false,
      generate_clip_audio: body.generateClipAudio === true,
      project_mode: projectMode,
      visualizer_reactivity: visualizerReactivity,
      audio_analysis_status: "idle",
      status: "draft",
      progress: 0,
    }).select(VIDEO_PROJECT_COLUMNS).single();

    if (error || !data) throw new MediaApiError("No se pudo crear el proyecto de video.", 500, "project_create_failed");
    return NextResponse.json({ project: toPublicVideoProject(data as unknown as VideoProjectRow) }, { status: 201 });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
