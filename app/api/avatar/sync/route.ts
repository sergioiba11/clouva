import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getMultiImageTask } from "@/lib/meshy";
import {
  AVATAR_SOURCE_BUCKET,
  downloadAndValidateGlb,
  persistMeshyAvatarSources,
} from "@/lib/avatar/meshy-avatar-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
      const metadata = asMetadata(avatar.metadata);
      const meshyTaskId = String(avatar.meshy_task_id ?? "");
      if (!meshyTaskId) continue;

      try {
        const task = await getMultiImageTask(meshyTaskId);

        if (["FAILED", "EXPIRED", "CANCELED"].includes(task.status)) {
          const message = task.task_error?.message ?? task.status;
          await supabase
            .from("user_avatars")
            .update({
              status: "failed",
              is_active: false,
              updated_at: new Date().toISOString(),
              metadata: { ...metadata, task_error: message, remote_status: task.status },
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
              metadata: { ...metadata, remote_status: task.status, progress: task.progress ?? null },
              updated_at: new Date().toISOString(),
            })
            .eq("id", avatar.id)
            .eq("user_id", userData.user.id);
          results.push({ id: avatar.id, status: "generating", remoteStatus: task.status, progress: task.progress });
          continue;
        }

        const now = new Date().toISOString();
        const isTriptychAvatar = metadata.generation_kind === "triptych-multi-image";

        if (isTriptychAvatar) {
          const stored = await persistMeshyAvatarSources({
            supabase,
            userId: userData.user.id,
            avatarId: avatar.id,
            task,
          });

          await supabase
            .from("user_avatars")
            .update({
              status: "pending_analysis",
              model_url: stored.modelUrl,
              storage_path: stored.sourceStoragePath,
              is_active: false,
              updated_at: now,
              metadata: {
                ...metadata,
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
              },
            })
            .eq("id", avatar.id)
            .eq("user_id", userData.user.id)
            .eq("status", "generating");

          results.push({ id: avatar.id, status: "pending_analysis", remoteStatus: task.status, progress: 100 });
          continue;
        }

        if (!task.model_urls?.glb) throw new Error("Meshy marcó la tarea como terminada pero no devolvió un GLB");
        const legacyGlb = await downloadAndValidateGlb(task.model_urls.glb, "el GLB de Meshy");
        const storagePath = `${userData.user.id}/${avatar.id}/avatar.glb`;
        const { error: uploadError } = await supabase.storage.from(AVATAR_SOURCE_BUCKET).upload(storagePath, legacyGlb.bytes, {
          contentType: "model/gltf-binary",
          cacheControl: "3600",
          upsert: true,
        });
        if (uploadError) throw uploadError;

        const { data: publicData } = supabase.storage.from(AVATAR_SOURCE_BUCKET).getPublicUrl(storagePath);
        await supabase
          .from("user_avatars")
          .update({
            status: "ready",
            model_url: publicData.publicUrl,
            storage_path: storagePath,
            updated_at: now,
            metadata: {
              ...metadata,
              original_meshy_url: task.model_urls.glb,
              source_sha256: legacyGlb.sha256,
              remote_status: task.status,
            },
          })
          .eq("id", avatar.id)
          .eq("user_id", userData.user.id);

        results.push({ id: avatar.id, status: "ready", remoteStatus: task.status, progress: 100 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Sync failed";
        await supabase
          .from("user_avatars")
          .update({ metadata: { ...metadata, sync_error: message }, updated_at: new Date().toISOString() })
          .eq("id", avatar.id)
          .eq("user_id", userData.user.id);
        results.push({ id: avatar.id, status: "generating", error: message });
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    console.error("Avatar sync failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Avatar sync failed" }, { status: 500 });
  }
}
