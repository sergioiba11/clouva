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
    const itemId = typeof body?.itemId === "string" ? body.itemId : "";
    const modelUrl = typeof body?.modelUrl === "string" ? body.modelUrl : "";
    if (!itemId || !modelUrl) return NextResponse.json({ error: "Faltan itemId o modelUrl" }, { status: 400 });

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

    const storagePath = `${userData.user.id}/clothing/${itemId}/garment.glb`;
    const { error: uploadError } = await supabase.storage.from("avatars").upload(storagePath, bytes, {
      contentType: "model/gltf-binary",
      cacheControl: "3600",
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(storagePath);

    const { data: item, error: updateError } = await supabase
      .from("clothing_items")
      .update({ status: "ready", model_url: publicData.publicUrl, updated_at: new Date().toISOString() })
      .eq("id", itemId)
      .eq("user_id", userData.user.id)
      .select("id,name,category,status,model_url,thumbnail_url")
      .single();
    if (updateError) throw updateError;

    return NextResponse.json({ ok: true, item });
  } catch (error) {
    console.error("Clothing finalization failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown clothing finalization error" },
      { status: 500 },
    );
  }
}
