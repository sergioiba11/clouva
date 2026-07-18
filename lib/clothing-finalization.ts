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

type ResolvedAvatar = {
  id: string;
  url: string;
  source: "user_avatars" | "profiles";
};

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    for (const key of ["message", "details", "detail", "hint", "error"]) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
  }
  return fallback;
}

async function resolveUserAvatar(supabase: FinalizationClient, userId: string): Promise<ResolvedAvatar> {
  const { data: active, error: activeError } = await supabase
    .from("user_avatars")
    .select("id,model_url,processed_glb_url,rigged_url,updated_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .eq("status", "ready")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeError) throw new Error(errorMessage(activeError, "No se pudo consultar el avatar activo"));
  const activeUrl = typeof active?.processed_glb_url === "string" && active.processed_glb_url
    ? active.processed_glb_url
    : typeof active?.rigged_url === "string" && active.rigged_url
      ? active.rigged_url
      : typeof active?.model_url === "string" && active.model_url
        ? active.model_url
        : null;

  if (active?.id && activeUrl) {
    return { id: String(active.id), url: activeUrl, source: "user_avatars" };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("avatar_3d_url")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) throw new Error(errorMessage(profileError, "No se pudo consultar el avatar del perfil"));
  if (typeof profile?.avatar_3d_url === "string" && profile.avatar_3d_url) {
    return { id: `profile-${userId}`, url: profile.avatar_3d_url, source: "profiles" };
  }

  throw new Error("No hay un avatar activo procesado para adaptar esta pieza");
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

async function rigWithWorker(
  supabase: FinalizationClient,
  userId: string,
  modelUrl: string,
  category: string,
  artUrl: string | null,
  color: string | null,
) {
  const workerUrl = process.env.GARMENT_RIG_WORKER_URL?.replace(/\/$/, "");
  if (!workerUrl) {
    return {
      bytes: null as ArrayBuffer | null,
      error: "GARMENT_RIG_WORKER_URL no está configurada",
      avatar: null as ResolvedAvatar | null,
    };
  }

  try {
    const avatar = await resolveUserAvatar(supabase, userId);
    const response = await fetch(`${workerUrl}/rig`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.GARMENT_RIG_WORKER_TOKEN
          ? { Authorization: `Bearer ${process.env.GARMENT_RIG_WORKER_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({
        avatar_url: avatar.url,
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
        avatar,
      };
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_GLB_BYTES) {
      return { bytes: null, error: "Rigged GLB exceeds 75 MB", avatar };
    }
    if (Buffer.from(bytes).subarray(0, 4).toString("ascii") !== "glTF") {
      return { bytes: null, error: "Rig worker did not return a valid GLB", avatar };
    }
    return { bytes, error: null as string | null, avatar };
  } catch (error) {
    return {
      bytes: null,
      error: errorMessage(error, "Unknown rigging error"),
      avatar: null as ResolvedAvatar | null,
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

  const rigResult = await rigWithWorker(supabase, userId, modelUrl, category, artUrl, color);
  const riggedBytes = rigResult.bytes;
  const bytes = riggedBytes ?? (await fetchGlb(modelUrl, "Meshy GLB"));
  const storagePath = `${userId}/clothing/${itemId}/${riggedBytes ? "rigged-textured" : "garment-fallback"}.glb`;

  const { error: uploadError } = await supabase.storage.from("avatars").upload(storagePath, bytes, {
    contentType: "model/gltf-binary",
    cacheControl: "3600",
    upsert: true,
  });
  if (uploadError) throw new Error(errorMessage(uploadError, "No se pudo guardar el GLB final"));

  const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(storagePath);
  const nextMetadata = {
    ...metadata,
    rigged: Boolean(riggedBytes),
    rig_pipeline: riggedBytes ? "blender-nearest-surface-uv-v2" : "viewer-fit-fallback",
    fitted_avatar_id: rigResult.avatar?.id ?? null,
    fitted_avatar_source: rigResult.avatar?.source ?? null,
    avatar_scope: "authenticated-user",
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
  if (updateError) throw new Error(errorMessage(updateError, "No se pudo actualizar la pieza final"));

  return {
    item,
    rigged: Boolean(riggedBytes),
    textured: Boolean(riggedBytes && artUrl),
    hoodSupported,
    warning: riggedBytes ? null : "La pieza quedó disponible sin rigging automático.",
  };
}
