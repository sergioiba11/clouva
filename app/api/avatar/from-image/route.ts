import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildAvatarMultiImageRequest, createAvatarMultiImageTask } from "@/lib/meshy";
import {
  MAX_TRIPTYCH_FILE_BYTES,
  TRIPTYCH_ALLOWED_TYPES,
  TRIPTYCH_REFERENCE_ORDER,
  type TriptychReferenceKey,
} from "@/lib/avatar/triptych";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

function extensionFor(file: File) {
  return file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
}

function validateReference(key: TriptychReferenceKey, value: FormDataEntryValue | null): File {
  if (!(value instanceof File)) throw new ApiError(`Falta la referencia ${key}`, 400);
  if (!TRIPTYCH_ALLOWED_TYPES.has(value.type)) throw new ApiError("Usá PNG, JPG o WEBP", 415);
  if (value.size <= 0) throw new ApiError("Una de las referencias está vacía", 400);
  if (value.size > MAX_TRIPTYCH_FILE_BYTES) {
    throw new ApiError("Cada referencia debe pesar como máximo 8 MB", 413);
  }
  return value;
}

export async function POST(request: NextRequest) {
  let uploadedPaths: string[] = [];
  let cleanupClient: ReturnType<typeof getAdminClient> | null = null;

  try {
    const authorization = request.headers.get("authorization");
    const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
    if (!accessToken) throw new ApiError("Missing access token", 401);

    const supabase = getAdminClient();
    cleanupClient = supabase;
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData.user) throw new ApiError("Invalid session", 401);

    const form = await request.formData();
    const references = Object.fromEntries(
      TRIPTYCH_REFERENCE_ORDER.map((key) => [key, validateReference(key, form.get(key))]),
    ) as Record<TriptychReferenceKey, File>;

    const avatarId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    const referencePaths = {} as Record<TriptychReferenceKey, string>;
    const referenceUrls = {} as Record<TriptychReferenceKey, string>;

    for (const key of TRIPTYCH_REFERENCE_ORDER) {
      const file = references[key];
      const storagePath = `${userData.user.id}/${avatarId}/references/${runId}/${key}.${extensionFor(file)}`;
      const { error: uploadError } = await supabase.storage.from("avatars").upload(storagePath, await file.arrayBuffer(), {
        contentType: file.type,
        cacheControl: "31536000",
        upsert: false,
      });
      if (uploadError) throw new Error(`Reference upload failed: ${uploadError.message}`);
      uploadedPaths.push(storagePath);
      referencePaths[key] = storagePath;
      const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(storagePath);
      if (!publicData.publicUrl) throw new Error("Reference URL generation failed");
      referenceUrls[key] = publicData.publicUrl;
    }

    const imageUrls = TRIPTYCH_REFERENCE_ORDER.map((key) => referenceUrls[key]);
    const meshyRequest = buildAvatarMultiImageRequest(imageUrls);
    const taskId = await createAvatarMultiImageTask(imageUrls);
    const now = new Date().toISOString();

    const { data: avatar, error: insertError } = await supabase
      .from("user_avatars")
      .insert({
        id: avatarId,
        user_id: userData.user.id,
        name: "Personaje 3D de lámina",
        source: "generated",
        status: "generating",
        model_url: null,
        storage_path: null,
        preview_image_url: referenceUrls.front,
        meshy_task_id: taskId,
        is_active: false,
        config: {},
        metadata: {
          generation_kind: "triptych-multi-image",
          reference_order: [...TRIPTYCH_REFERENCE_ORDER],
          reference_paths: referencePaths,
          reference_urls: referenceUrls,
          meshy_request: meshyRequest,
          meshy_task_id: taskId,
          generation_requested_at: now,
          analyzer_status: "not_started",
        },
      })
      .select("id,user_id,name,status,preview_image_url,meshy_task_id,is_active,created_at,updated_at")
      .single();
    if (insertError) throw new Error(`Avatar draft insert failed: ${insertError.message}`);

    uploadedPaths = [];
    return NextResponse.json({ taskId, avatarId, avatar });
  } catch (error) {
    if (uploadedPaths.length && cleanupClient) {
      await cleanupClient.storage.from("avatars").remove(uploadedPaths).catch(() => undefined);
    }
    if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Triptych avatar generation failed", error);
    return NextResponse.json({ error: "No se pudo iniciar la generación del personaje" }, { status: 500 });
  }
}
