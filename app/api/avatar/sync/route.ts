import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getMultiImageTask } from "@/lib/meshy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_GLB_BYTES = 25 * 1024 * 1024;

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
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
      .select("id,name,meshy_task_id,status")
      .eq("user_id", userData.user.id)
      .eq("status", "generating")
      .not("meshy_task_id", "is", null);
    if (pendingError) throw pendingError;

    const results: Array<{ id: string; status: string; error?: string }> = [];

    for (const avatar of pending ?? []) {
      try {
        const task = await getMultiImageTask(avatar.meshy_task_id);

        if (task.status === "FAILED" || task.status === "EXPIRED") {
          await supabase
            .from("user_avatars")
            .update({
              status: "failed",
              updated_at: new Date().toISOString(),
              metadata: { task_error: task.task_error?.message ?? task.status },
            })
            .eq("id", avatar.id)
            .eq("user_id", userData.user.id);
          results.push({ id: avatar.id, status: "failed" });
          continue;
        }

        if (task.status !== "SUCCEEDED" || !task.model_urls?.glb) {
          results.push({ id: avatar.id, status: "generating" });
          continue;
        }

        const remote = await fetch(task.model_urls.glb, { redirect: "follow", cache: "no-store" });
        if (!remote.ok) throw new Error(`Could not download Meshy GLB (${remote.status})`);

        const contentLength = Number(remote.headers.get("content-length") || 0);
        if (contentLength > MAX_GLB_BYTES) throw new Error("Generated GLB exceeds 25 MB");

        const bytes = await remote.arrayBuffer();
        if (bytes.byteLength > MAX_GLB_BYTES) throw new Error("Generated GLB exceeds 25 MB");
        if (Buffer.from(bytes).subarray(0, 4).toString("ascii") !== "glTF") {
          throw new Error("Meshy did not return a valid GLB");
        }

        const storagePath = `${userData.user.id}/${avatar.id}/avatar.glb`;
        const { error: uploadError } = await supabase.storage.from("avatars").upload(storagePath, bytes, {
          contentType: "model/gltf-binary",
          cacheControl: "3600",
          upsert: true,
        });
        if (uploadError) throw uploadError;

        const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(storagePath);
        const finalModelUrl = publicData.publicUrl;
        const now = new Date().toISOString();

        await supabase
          .from("user_avatars")
          .update({
            status: "ready",
            model_url: finalModelUrl,
            storage_path: storagePath,
            updated_at: now,
            metadata: { original_meshy_url: task.model_urls.glb },
          })
          .eq("id", avatar.id)
          .eq("user_id", userData.user.id);

        results.push({ id: avatar.id, status: "ready" });
      } catch (error) {
        results.push({
          id: avatar.id,
          status: "generating",
          error: error instanceof Error ? error.message : "Sync failed",
        });
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    console.error("Avatar sync failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Avatar sync failed" },
      { status: 500 },
    );
  }
}
