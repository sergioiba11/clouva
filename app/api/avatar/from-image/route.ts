import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createMultiImageTask } from "@/lib/meshy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

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

    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File)) return NextResponse.json({ error: "Falta la imagen" }, { status: 400 });
    if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: "Usá PNG, JPG o WEBP" }, { status: 415 });
    if (file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "La imagen supera 8 MB" }, { status: 413 });

    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const referenceId = crypto.randomUUID();
    const storagePath = `${userData.user.id}/references/${referenceId}.${extension}`;
    const bytes = await file.arrayBuffer();

    const { error: uploadError } = await supabase.storage.from("avatars").upload(storagePath, bytes, {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(storagePath);
    const imageUrl = publicData.publicUrl;
    const taskId = await createMultiImageTask([imageUrl]);
    const avatarId = crypto.randomUUID();

    const { data: avatar, error: insertError } = await supabase
      .from("user_avatars")
      .insert({
        id: avatarId,
        user_id: userData.user.id,
        name: "Avatar desde referencia",
        source: "generated",
        status: "generating",
        model_url: null,
        storage_path: null,
        preview_image_url: imageUrl,
        meshy_task_id: taskId,
        is_active: false,
        config: {},
        metadata: { generation_kind: "multi-image", reference_path: storagePath },
      })
      .select("id,user_id,name,status,preview_image_url,meshy_task_id,is_active,created_at,updated_at")
      .single();
    if (insertError) throw insertError;

    return NextResponse.json({ taskId, imageUrl, avatar });
  } catch (error) {
    console.error("Image avatar generation failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo iniciar la generación" },
      { status: 500 },
    );
  }
}
