import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getMultiImageTask } from "@/lib/meshy";
import { persistMeshyAvatarSources } from "@/lib/avatar/meshy-avatar-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly details?: Record<string, unknown>) {
    super(message);
  }
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

function asMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
    if (!accessToken) throw new ApiError("Missing access token", 401);

    const supabase = getAdminClient();
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData.user) throw new ApiError("Invalid session", 401);

    const body = await request.json().catch(() => ({}));
    const meshyTaskId = typeof body?.meshyTaskId === "string" ? body.meshyTaskId.trim() : "";
    const requestedName = typeof body?.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 80)
      : null;
    if (!meshyTaskId) throw new ApiError("Missing meshyTaskId", 400);

    const { data: pendingAvatar, error: pendingError } = await supabase
      .from("user_avatars")
      .select("id,name,status,model_url,storage_path,is_active,metadata,front_rotation_y,created_at,updated_at")
      .eq("user_id", userData.user.id)
      .eq("meshy_task_id", meshyTaskId)
      .maybeSingle();
    if (pendingError) throw new Error(`Pending avatar lookup failed: ${pendingError.message}`);
    if (!pendingAvatar) throw new ApiError("La tarea no pertenece a un avatar pendiente de tu cuenta", 404);

    const existingMetadata = asMetadata(pendingAvatar.metadata);
    if (existingMetadata.generation_kind !== "triptych-multi-image") {
      throw new ApiError("La tarea no corresponde al creador de avatares por lámina", 409);
    }

    if (pendingAvatar.status === "pending_analysis" && pendingAvatar.model_url) {
      return NextResponse.json({ ok: true, avatar: pendingAvatar, alreadyFinalized: true });
    }
    if (pendingAvatar.status !== "generating") {
      throw new ApiError("El avatar ya no está pendiente de generación", 409);
    }

    const task = await getMultiImageTask(meshyTaskId);
    if (task.status !== "SUCCEEDED") {
      if (["FAILED", "EXPIRED", "CANCELED"].includes(task.status)) {
        const taskError = task.task_error?.message || `Meshy finalizó con estado ${task.status}`;
        await supabase
          .from("user_avatars")
          .update({
            status: "failed",
            is_active: false,
            updated_at: new Date().toISOString(),
            metadata: {
              ...existingMetadata,
              remote_status: task.status,
              task_error: taskError,
            },
          })
          .eq("id", pendingAvatar.id)
          .eq("user_id", userData.user.id);
        throw new ApiError(taskError, 422);
      }
      throw new ApiError("Meshy todavía está generando el personaje", 409, {
        status: task.status,
        progress: task.progress ?? 0,
      });
    }

    const stored = await persistMeshyAvatarSources({
      supabase,
      userId: userData.user.id,
      avatarId: pendingAvatar.id,
      task,
    });

    const now = new Date().toISOString();
    const metadata = {
      ...existingMetadata,
      generation_kind: "triptych-multi-image",
      meshy_task_id: meshyTaskId,
      source_sha256: stored.sourceSha256,
      source_storage_path: stored.sourceStoragePath,
      pre_remeshed_storage_path: stored.preRemeshedStoragePath,
      pre_remeshed_sha256: stored.preRemeshedSha256,
      source_immutable: true,
      generated_at: now,
      analyzer_status: "not_started",
      remote_status: task.status,
      remote_model_urls: {
        temporary: true,
        glb: task.model_urls?.glb ?? null,
        pre_remeshed_glb: task.model_urls?.pre_remeshed_glb ?? null,
      },
      remote_thumbnails: {
        temporary: true,
        thumbnail_url: task.thumbnail_url ?? null,
        thumbnail_urls: task.thumbnail_urls ?? [],
      },
    };

    const { data: avatar, error: saveError } = await supabase
      .from("user_avatars")
      .update({
        name: requestedName ?? pendingAvatar.name,
        status: "pending_analysis",
        model_url: stored.modelUrl,
        storage_path: stored.sourceStoragePath,
        is_active: false,
        updated_at: now,
        metadata,
      })
      .eq("id", pendingAvatar.id)
      .eq("user_id", userData.user.id)
      .eq("status", "generating")
      .select("id,user_id,name,source,status,model_url,storage_path,preview_image_url,is_active,front_rotation_y,created_at,updated_at,metadata")
      .single();
    if (saveError || !avatar) throw new Error(`Avatar draft finalization failed: ${saveError?.message || "unknown error"}`);

    return NextResponse.json({ ok: true, avatar });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message, ...(error.details ?? {}) }, { status: error.status });
    }
    console.error("Generated avatar finalization failed", error);
    return NextResponse.json({ error: "No se pudo guardar permanentemente el personaje" }, { status: 500 });
  }
}
