import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  AvatarGenerationError,
  asAvatarMetadata,
  downloadGeneratedGlb,
  finalizePendingAvatarGeneration,
  isTriptychAvatarMetadata,
} from "@/lib/avatar-generation-server";
import { getMultiImageTask, type MeshyTask } from "@/lib/meshy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function finalizeLegacyMultiImageAvatar(args: {
  supabase: SupabaseClient;
  userId: string;
  avatar: { id: string; metadata: unknown };
  task: MeshyTask;
}) {
  const { supabase, userId, avatar, task } = args;
  if (!task.model_urls?.glb) throw new AvatarGenerationError("Meshy terminó sin devolver un GLB", 502);

  const glb = await downloadGeneratedGlb(task.model_urls.glb, "GLB de Meshy");
  const storagePath = `${userId}/${avatar.id}/avatar.glb`;
  const bucket = supabase.storage.from("avatars");
  const { error: uploadError } = await bucket.upload(storagePath, glb.bytes, {
    contentType: "model/gltf-binary",
    cacheControl: "3600",
    upsert: true,
  });
  if (uploadError) throw new AvatarGenerationError("No se pudo guardar el GLB generado", 500);

  const { data: publicData } = bucket.getPublicUrl(storagePath);
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("user_avatars")
    .update({
      status: "ready",
      model_url: publicData.publicUrl,
      storage_path: storagePath,
      updated_at: now,
      metadata: {
        ...asAvatarMetadata(avatar.metadata),
        original_meshy_url: task.model_urls.glb,
        glb_sha256: glb.sha256,
        glb_size_bytes: glb.sizeBytes,
        remote_status: task.status,
      },
    })
    .eq("id", avatar.id)
    .eq("user_id", userId)
    .eq("status", "generating");
  if (updateError) throw new AvatarGenerationError("No se pudo actualizar la generación anterior", 500);
}

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
    if (!accessToken) return NextResponse.json({ error: "Missing access token" }, { status: 401 });

    const supabase = getAdminClient();
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData.user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    const { data: pending, error: pendingError } = await supabase
      .from("user_avatars")
      .select("id,name,meshy_task_id,status,metadata")
      .eq("user_id", userData.user.id)
      .eq("status", "generating")
      .not("meshy_task_id", "is", null);
    if (pendingError) throw pendingError;

    const results: Array<{ id: string; status: string; remoteStatus?: string; progress?: number; error?: string }> = [];

    for (const avatar of pending ?? []) {
      const meshyTaskId = String(avatar.meshy_task_id ?? "");
      if (!meshyTaskId) continue;

      try {
        const task = await getMultiImageTask(meshyTaskId);
        const previousMetadata = asAvatarMetadata(avatar.metadata);

        if (["FAILED", "EXPIRED", "CANCELED"].includes(task.status)) {
          const message = task.task_error?.message
            || (typeof task.error === "string" ? task.error : task.error?.message)
            || task.status;
          await supabase
            .from("user_avatars")
            .update({
              status: "failed",
              updated_at: new Date().toISOString(),
              metadata: { ...previousMetadata, task_error: message, remote_status: task.status },
            })
            .eq("id", avatar.id)
            .eq("user_id", userData.user.id);
          results.push({ id: avatar.id, status: "failed", remoteStatus: task.status, error: message });
          continue;
        }

        if (task.status !== "SUCCEEDED") {
          await supabase
            .from("user_avatars")
            .update({
              metadata: { ...previousMetadata, remote_status: task.status, progress: task.progress ?? null },
              updated_at: new Date().toISOString(),
            })
            .eq("id", avatar.id)
            .eq("user_id", userData.user.id);
          results.push({ id: avatar.id, status: "generating", remoteStatus: task.status, progress: task.progress });
          continue;
        }

        if (isTriptychAvatarMetadata(previousMetadata)) {
          await finalizePendingAvatarGeneration(supabase, userData.user.id, meshyTaskId);
          results.push({ id: avatar.id, status: "pending_analysis", remoteStatus: task.status, progress: 100 });
        } else {
          await finalizeLegacyMultiImageAvatar({ supabase, userId: userData.user.id, avatar, task });
          results.push({ id: avatar.id, status: "ready", remoteStatus: task.status, progress: 100 });
        }
      } catch (error) {
        console.error("Avatar sync item failed", { avatarId: avatar.id, error });
        const message = error instanceof AvatarGenerationError
          ? error.message
          : "No se pudo sincronizar esta generación";
        await supabase
          .from("user_avatars")
          .update({
            metadata: { ...asAvatarMetadata(avatar.metadata), sync_error: message },
            updated_at: new Date().toISOString(),
          })
          .eq("id", avatar.id)
          .eq("user_id", userData.user.id);
        results.push({ id: avatar.id, status: "generating", error: message });
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    console.error("Avatar sync failed", error);
    return NextResponse.json({ error: "No se pudo sincronizar la biblioteca de avatares" }, { status: 500 });
  }
}
