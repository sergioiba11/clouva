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

function officialAvatarUrl() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!base) throw new Error("Missing Supabase URL for official avatar");
  return `${base}/storage/v1/object/public/avatars/official/clouva-official-v1.glb`;
}

async function fetchGlb(url: string, label: string) {
  const response = await fetch(url, { redirect: "follow", cache: "no-store" });
  if (!response.ok) throw new Error(`${label} download failed (${response.status})`);

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_GLB_BYTES) throw new Error(`${label} exceeds 75 MB`);

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_GLB_BYTES) throw new Error(`${label} exceeds 75 MB`);
  if (Buffer.from(bytes).subarray(0, 4).toString("ascii") !== "glTF") {
    throw new Error(`${label} is not a valid GLB`);
  }
  return bytes;
}

async function rigWithWorker(modelUrl: string, category: string) {
  const workerUrl = process.env.GARMENT_RIG_WORKER_URL?.replace(/\/$/, "");
  if (!workerUrl) return null;

  const response = await fetch(`${workerUrl}/rig`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.GARMENT_RIG_WORKER_TOKEN
        ? { Authorization: `Bearer ${process.env.GARMENT_RIG_WORKER_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      avatar_url: officialAvatarUrl(),
      garment_url: modelUrl,
      category,
    }),
    signal: AbortSignal.timeout(8 * 60 * 1000),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Automatic rigging failed (${response.status}): ${detail.slice(0, 1200)}`);
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_GLB_BYTES) throw new Error("Rigged GLB exceeds 75 MB");
  if (Buffer.from(bytes).subarray(0, 4).toString("ascii") !== "glTF") {
    throw new Error("Rig worker did not return a valid GLB");
  }
  return bytes;
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

    const { data: sourceItem, error: sourceError } = await supabase
      .from("clothing_items")
      .select("id,category")
      .eq("id", itemId)
      .eq("user_id", userData.user.id)
      .single();
    if (sourceError || !sourceItem) return NextResponse.json({ error: "Clothing item not found" }, { status: 404 });

    await supabase
      .from("clothing_items")
      .update({ status: "rigging", updated_at: new Date().toISOString() })
      .eq("id", itemId)
      .eq("user_id", userData.user.id);

    const riggedBytes = await rigWithWorker(modelUrl, sourceItem.category);
    const bytes = riggedBytes ?? (await fetchGlb(modelUrl, "Meshy GLB"));
    const storagePath = `${userData.user.id}/clothing/${itemId}/${riggedBytes ? "rigged" : "garment"}.glb`;

    const { error: uploadError } = await supabase.storage.from("avatars").upload(storagePath, bytes, {
      contentType: "model/gltf-binary",
      cacheControl: "3600",
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(storagePath);

    const { data: item, error: updateError } = await supabase
      .from("clothing_items")
      .update({
        status: "ready",
        model_url: publicData.publicUrl,
        updated_at: new Date().toISOString(),
        metadata: {
          rigged: Boolean(riggedBytes),
          rig_pipeline: riggedBytes ? "blender-nearest-surface-v1" : "viewer-fit-fallback",
          official_avatar: "clouva-official-v1",
        },
      })
      .eq("id", itemId)
      .eq("user_id", userData.user.id)
      .select("id,name,category,status,model_url,thumbnail_url,metadata")
      .single();
    if (updateError) throw updateError;

    return NextResponse.json({ ok: true, item, rigged: Boolean(riggedBytes) });
  } catch (error) {
    console.error("Clothing finalization failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown clothing finalization error" },
      { status: 500 },
    );
  }
}
