import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { finalizePendingAvatarGeneration } from "@/lib/avatar-generation-server";
import { getMultiImageTask } from "@/lib/meshy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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
      try {
        const task = await getMultiImageTask(avatar.meshy_task_id);
        const previousMetadata = asRecord(avatar.metadata);

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

        await finalizePendingAvatarGeneration(supabase, userData.user.id, avatar.meshy_task_id);
        results.push({ id: avatar.id, status: "pending_analysis", remoteStatus: task.status, progress: 100 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Sync failed";
        await supabase
          .from("user_avatars")
          .update({
            metadata: { ...asRecord(avatar.metadata), sync_error: message },
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
    return NextResponse.json({ error: error instanceof Error ? error.message : "Avatar sync failed" }, { status: 500 });
  }
}
