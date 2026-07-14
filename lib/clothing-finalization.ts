import { createClient } from "@supabase/supabase-js";

const MAX_GLB_BYTES = 75 * 1024 * 1024;

type AdminClient = ReturnType<typeof createClient>;
type ItemMetadata = Record<string, unknown>;

type FinalizeInput = {
  supabase: AdminClient;
  userId: string;
  itemId: string;
  modelUrl: string;
  category: string;
  color: string | null;
  metadata: ItemMetadata;
};

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

async function rigWithWorker(modelUrl: string, category: string, artUrl: string | null, color: string | null) {
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
      art_url: artUrl,
      color,
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

export async function finalizeClothingItem({
  supabase,
  userId,
  itemId,
  modelUrl,
  category,
  color,
  metadata,
}: FinalizeInput) {
  const artUrl = typeof metadata.art_url === "string" && metadata.art_url ? metadata.art_url : null;

  const riggedBytes = await rigWithWorker(modelUrl, category, artUrl, color);
  const bytes = riggedBytes ?? (await fetchGlb(modelUrl, "Meshy GLB"));
  const storagePath = `${userId}/clothing/${itemId}/${riggedBytes ? "rigged-textured" : "garment"}.glb`;

  const { error: uploadError } = await supabase.storage.from("avatars").upload(storagePath, bytes, {
    contentType: "model/gltf-binary",
    cacheControl: "3600",
    upsert: true,
  });
  if (uploadError) throw uploadError;

  const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(storagePath);
  const nextMetadata = {
    ...metadata,
    rigged: Boolean(riggedBytes),
    rig_pipeline: riggedBytes ? "blender-nearest-surface-uv-v2" : "viewer-fit-fallback",
    official_avatar: "clouva-official-v1",
    uv_generated: Boolean(riggedBytes),
    textured: Boolean(riggedBytes && artUrl),
    texture_source: artUrl,
    generation_stage: "ready",
    generation_progress: 100,
  };

  const { data: item, error: updateError } = await supabase
    .from("clothing_items")
    .update({
      status: "ready",
      model_url: publicData.publicUrl,
      updated_at: new Date().toISOString(),
      metadata: nextMetadata,
    })
    .eq("id", itemId)
    .eq("user_id", userId)
    .select("id,name,category,status,model_url,thumbnail_url,metadata")
    .single();
  if (updateError) throw updateError;

  return {
    item,
    rigged: Boolean(riggedBytes),
    textured: Boolean(riggedBytes && artUrl),
  };
}
