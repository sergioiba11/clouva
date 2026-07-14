const MAX_GLB_BYTES = 75 * 1024 * 1024;

type ItemMetadata = Record<string, unknown>;

type FinalizationClient = {
  storage: {
    from: (bucket: string) => {
      upload: (
        path: string,
        body: ArrayBuffer,
        options: { contentType: string; cacheControl: string; upsert: boolean },
      ) => Promise<{ error: { message?: string } | null }>;
      getPublicUrl: (path: string) => { data: { publicUrl: string } };
    };
  };
  from: (table: string) => any;
};

type FinalizeInput = {
  supabase: FinalizationClient;
  userId: string;
  itemId: string;
  modelUrl: string;
  category: string;
  color: string | null;
  metadata: ItemMetadata;
};

async function officialAvatarUrl(supabase: FinalizationClient) {
  const { data, error } = await supabase
    .from("profiles")
    .select("avatar_3d_url")
    .eq("role", "admin")
    .not("avatar_3d_url", "is", null)
    .limit(1)
    .maybeSingle();
  if (error || !data?.avatar_3d_url) {
    throw new Error("No hay avatar oficial activo configurado (profiles.avatar_3d_url del admin)");
  }
  return data.avatar_3d_url as string;
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

async function rigWithWorker(supabase: FinalizationClient, modelUrl: string, category: string, artUrl: string | null, color: string | null) {
  const workerUrl = process.env.GARMENT_RIG_WORKER_URL?.replace(/\/$/, "");
  if (!workerUrl) return { bytes: null as ArrayBuffer | null, error: "GARMENT_RIG_WORKER_URL no está configurada" };

  try {
    const avatarUrl = await officialAvatarUrl(supabase);
    const response = await fetch(`${workerUrl}/rig`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.GARMENT_RIG_WORKER_TOKEN
          ? { Authorization: `Bearer ${process.env.GARMENT_RIG_WORKER_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        avatar_url: avatarUrl,
        garment_url: modelUrl,
        category,
        art_url: artUrl,
        color,
      }),
      signal: AbortSignal.timeout(8 * 60 * 1000),
    });

    if (!response.ok) {
      const detail = await response.text();
      return {
        bytes: null,
        error: `Automatic rigging failed (${response.status}): ${detail.slice(0, 1200)}`,
      };
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_GLB_BYTES) {
      return { bytes: null, error: "Rigged GLB exceeds 75 MB" };
    }
    if (Buffer.from(bytes).subarray(0, 4).toString("ascii") !== "glTF") {
      return { bytes: null, error: "Rig worker did not return a valid GLB" };
    }
    return { bytes, error: null as string | null };
  } catch (error) {
    return {
      bytes: null,
      error: error instanceof Error ? error.message : "Unknown rigging error",
    };
  }
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
  const hoodUpModelUrl = typeof metadata.hood_up_model_url === "string" && metadata.hood_up_model_url ? metadata.hood_up_model_url : null;
  const hoodDownModelUrl = typeof metadata.hood_down_model_url === "string" && metadata.hood_down_model_url ? metadata.hood_down_model_url : null;
  const hoodSupported = Boolean(hoodUpModelUrl && hoodDownModelUrl && (category === "hoodie" || category === "jacket"));

  const rigResult = await rigWithWorker(supabase, modelUrl, category, artUrl, color);
  const riggedBytes = rigResult.bytes;
  const bytes = riggedBytes ?? (await fetchGlb(modelUrl, "Meshy GLB"));
  const storagePath = `${userId}/clothing/${itemId}/${riggedBytes ? "rigged-textured" : "garment-fallback"}.glb`;

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
    compatibility_warning: riggedBytes ? null : "La pieza quedó disponible sin rigging automático.",
    rigging_last_error: riggedBytes ? null : rigResult.error,
    hood_supported: hoodSupported,
    hood_note: hoodSupported ? null : "Falta generar y subir la variante hood_up además de hood_down.",
  };

  const { data: item, error: updateError } = await supabase
    .from("clothing_items")
    .update({
      status: "ready",
      model_url: publicData.publicUrl,
      updated_at: new Date().toISOString(),
      metadata: nextMetadata,
      rigged: Boolean(riggedBytes),
      fit_status: riggedBytes ? "fitted" : "fallback",
      wearable: Boolean(riggedBytes),
      processing_error: riggedBytes ? null : rigResult.error,
      hood_supported: hoodSupported,
      hood_state: hoodSupported ? "down" : null,
      hood_up_model_url: hoodUpModelUrl,
      hood_down_model_url: hoodDownModelUrl,
    })
    .eq("id", itemId)
    .eq("user_id", userId)
    .select("id,name,category,status,model_url,thumbnail_url,metadata,fit_status,rigged,wearable,hood_supported,hood_state,hood_up_model_url,hood_down_model_url")
    .single();
  if (updateError) throw updateError;

  return {
    item,
    rigged: Boolean(riggedBytes),
    textured: Boolean(riggedBytes && artUrl),
    hoodSupported,
    warning: riggedBytes ? null : "La pieza quedó disponible sin rigging automático.",
  };
}
