import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { AVATAR_MULTI_IMAGE_TASK_CONFIG, createAvatarMultiImageTask } from "@/lib/meshy";
import {
  ALLOWED_AVATAR_REFERENCE_TYPES,
  AVATAR_REFERENCE_ORDER,
  MAX_AVATAR_REFERENCE_BYTES,
  type AvatarReferenceRole,
} from "@/lib/avatar-triptych";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

function extensionFor(file: File) {
  return file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
}

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
    if (!accessToken) return NextResponse.json({ error: "Missing access token" }, { status: 401 });

    const supabase = getAdminClient();
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData.user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    const form = await request.formData();
    const files = {} as Record<AvatarReferenceRole, File>;

    for (const [key] of form.entries()) {
      if (!AVATAR_REFERENCE_ORDER.includes(key as AvatarReferenceRole)) {
        return NextResponse.json({ error: `Campo inesperado: ${key}` }, { status: 400 });
      }
    }

    for (const role of AVATAR_REFERENCE_ORDER) {
      const values = form.getAll(role);
      if (values.length !== 1 || !(values[0] instanceof File)) {
        return NextResponse.json({ error: "Se requieren exactamente front, back y side" }, { status: 400 });
      }
      const file = values[0];
      if (!ALLOWED_AVATAR_REFERENCE_TYPES.has(file.type)) {
        return NextResponse.json({ error: `${role}: usá PNG, JPG o WEBP` }, { status: 415 });
      }
      if (file.size <= 0 || file.size > MAX_AVATAR_REFERENCE_BYTES) {
        return NextResponse.json({ error: `${role}: cada referencia debe pesar entre 1 byte y 8 MB` }, { status: 413 });
      }
      files[role] = file;
    }

    const avatarId = crypto.randomUUID();
    const executionId = crypto.randomUUID();
    const uploadedPaths: string[] = [];

    try {
      const uploads: Array<{
        role: AvatarReferenceRole;
        storagePath: string;
        publicUrl: string;
      }> = [];

      for (const role of AVATAR_REFERENCE_ORDER) {
        const file = files[role];
        const storagePath = `${userData.user.id}/${avatarId}/references/${executionId}/avatar-${role}.${extensionFor(file)}`;
        const { error: uploadError } = await supabase.storage.from("avatars").upload(storagePath, await file.arrayBuffer(), {
          contentType: file.type,
          cacheControl: "31536000",
          upsert: false,
        });
        if (uploadError) throw uploadError;
        uploadedPaths.push(storagePath);
        const { data } = supabase.storage.from("avatars").getPublicUrl(storagePath);
        uploads.push({ role, storagePath, publicUrl: data.publicUrl });
      }

      const imageUrls = AVATAR_REFERENCE_ORDER.map((role) => uploads.find((item) => item.role === role)?.publicUrl ?? "");
      if (imageUrls.some((url) => !url)) throw new Error("No se pudo conservar el orden frente, espalda y costado");

      const taskId = await createAvatarMultiImageTask(imageUrls);
      const referencePaths = Object.fromEntries(uploads.map((item) => [item.role, item.storagePath]));
      const referenceUrls = Object.fromEntries(uploads.map((item) => [item.role, item.publicUrl]));
      const now = new Date().toISOString();

      const { data: avatar, error: insertError } = await supabase
        .from("user_avatars")
        .insert({
          id: avatarId,
          user_id: userData.user.id,
          name: "Avatar por lámina",
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
            reference_order: [...AVATAR_REFERENCE_ORDER],
            reference_paths: referencePaths,
            reference_urls: referenceUrls,
            reference_execution_id: executionId,
            meshy_task_id: taskId,
            meshy_configuration: {
              image_urls: imageUrls,
              ...AVATAR_MULTI_IMAGE_TASK_CONFIG,
            },
            analyzer_status: "not_started",
            timestamp: now,
            created_at: now,
          },
        })
        .select("id,user_id,name,status,preview_image_url,meshy_task_id,is_active,created_at,updated_at")
        .single();
      if (insertError) throw insertError;

      return NextResponse.json({ taskId, avatar });
    } catch (error) {
      if (uploadedPaths.length) await supabase.storage.from("avatars").remove(uploadedPaths);
      throw error;
    }
  } catch (error) {
    console.error("Triptych avatar generation failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo iniciar la generación" },
      { status: 500 },
    );
  }
}
