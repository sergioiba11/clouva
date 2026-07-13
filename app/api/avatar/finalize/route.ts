import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_GLB_BYTES = 75 * 1024 * 1024;

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

    const body = await request.json();
    const modelUrl = typeof body?.modelUrl === "string" ? body.modelUrl : "";
    const meshyTaskId = typeof body?.meshyTaskId === "string" ? body.meshyTaskId : null;
    const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : "Mi avatar IA";

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(modelUrl);
    } catch {
      return NextResponse.json({ error: "Invalid model URL" }, { status: 400 });
    }
    if (parsedUrl.protocol !== "https:") return NextResponse.json({ error: "Model URL must use HTTPS" }, { status: 400 });

    const remote = await fetch(parsedUrl, { redirect: "follow", cache: "no-store" });
    if (!remote.ok) return NextResponse.json({ error: `Could not download Meshy GLB (${remote.status})` }, { status: 502 });

    const contentLength = Number(remote.headers.get("content-length") || 0);
    if (contentLength > MAX_GLB_BYTES) return NextResponse.json({ error: "Generated GLB exceeds 75 MB" }, { status: 413 });

    const bytes = await remote.arrayBuffer();
    if (bytes.byteLength > MAX_GLB_BYTES) return NextResponse.json({ error: "Generated GLB exceeds 75 MB" }, { status: 413 });
    if (Buffer.from(bytes).subarray(0, 4).toString("ascii") !== "glTF") {
      return NextResponse.json({ error: "Meshy did not return a valid GLB" }, { status: 422 });
    }

    const { data: pendingAvatar } = meshyTaskId
      ? await supabase
          .from("user_avatars")
          .select("id")
          .eq("user_id", userData.user.id)
          .eq("meshy_task_id", meshyTaskId)
          .maybeSingle()
      : { data: null };

    const avatarId = pendingAvatar?.id ?? crypto.randomUUID();
    const storagePath = `${userData.user.id}/${avatarId}/avatar.glb`;

    const { error: uploadError } = await supabase.storage.from("avatars").upload(storagePath, bytes, {
      contentType: "model/gltf-binary",
      cacheControl: "3600",
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(storagePath);
    const finalModelUrl = publicData.publicUrl;
    const now = new Date().toISOString();

    const { error: deactivateError } = await supabase
      .from("user_avatars")
      .update({ is_active: false, updated_at: now })
      .eq("user_id", userData.user.id)
      .eq("is_active", true);
    if (deactivateError) throw deactivateError;

    const payload = {
      user_id: userData.user.id,
      name,
      source: "generated",
      status: "ready",
      model_url: finalModelUrl,
      storage_path: storagePath,
      meshy_task_id: meshyTaskId,
      is_active: true,
      updated_at: now,
      config: {},
      metadata: { original_meshy_url: modelUrl },
    };

    const query = pendingAvatar
      ? supabase.from("user_avatars").update(payload).eq("id", avatarId)
      : supabase.from("user_avatars").insert({ id: avatarId, ...payload });

    const { data: avatar, error: saveError } = await query
      .select("id,user_id,name,source,status,model_url,preview_image_url,is_active,front_rotation_y,created_at,updated_at")
      .single();
    if (saveError) throw saveError;

    await supabase.from("profiles").update({ avatar_3d_url: finalModelUrl }).eq("id", userData.user.id);

    return NextResponse.json({ ok: true, avatar });
  } catch (error) {
    console.error("Generated avatar finalization failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown avatar finalization error" },
      { status: 500 },
    );
  }
}
