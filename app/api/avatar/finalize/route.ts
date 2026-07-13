import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
    if (userError || !userData.user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }

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
    if (parsedUrl.protocol !== "https:") {
      return NextResponse.json({ error: "Model URL must use HTTPS" }, { status: 400 });
    }

    const remote = await fetch(parsedUrl, { redirect: "follow", cache: "no-store" });
    if (!remote.ok) {
      return NextResponse.json({ error: `Could not download Meshy GLB (${remote.status})` }, { status: 502 });
    }

    const contentLength = Number(remote.headers.get("content-length") || 0);
    if (contentLength > MAX_GLB_BYTES) {
      return NextResponse.json({ error: "Generated GLB exceeds 25 MB" }, { status: 413 });
    }

    const bytes = await remote.arrayBuffer();
    if (bytes.byteLength > MAX_GLB_BYTES) {
      return NextResponse.json({ error: "Generated GLB exceeds 25 MB" }, { status: 413 });
    }
    const header = Buffer.from(bytes).subarray(0, 4).toString("ascii");
    if (header !== "glTF") {
      return NextResponse.json({ error: "Meshy did not return a valid GLB" }, { status: 422 });
    }

    const avatarId = crypto.randomUUID();
    const storagePath = `${userData.user.id}/${avatarId}/avatar.glb`;

    const { error: uploadError } = await supabase.storage.from("avatars").upload(storagePath, bytes, {
      contentType: "model/gltf-binary",
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(storagePath);
    const finalModelUrl = publicData.publicUrl;

    const { error: deactivateError } = await supabase
      .from("user_avatars")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("user_id", userData.user.id)
      .eq("is_active", true);
    if (deactivateError) throw deactivateError;

    const { data: avatar, error: insertError } = await supabase
      .from("user_avatars")
      .insert({
        id: avatarId,
        user_id: userData.user.id,
        name,
        source: "generated",
        status: "ready",
        model_url: finalModelUrl,
        storage_path: storagePath,
        meshy_task_id: meshyTaskId,
        is_active: true,
        config: {},
        metadata: { original_meshy_url: modelUrl },
      })
      .select("id,user_id,name,source,status,model_url,is_active,front_rotation_y,updated_at")
      .single();
    if (insertError) throw insertError;

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
