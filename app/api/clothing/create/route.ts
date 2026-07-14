import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createMultiImageTask } from "@/lib/meshy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const CATEGORIES = new Set(["hoodie", "shirt", "jacket", "pants", "shorts", "shoes", "accessory"]);

const BASE_STYLE_PROMPT =
  "Clean, game-ready streetwear garment for a stylized 3D avatar. Flat, even, well-lit texture. No visible mannequin or body parts in the texture.";

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
    const front = form.get("front");
    const back = form.get("back");
    const side = form.get("side");
    const category = String(form.get("category") ?? "");
    const description = String(form.get("description") ?? "").slice(0, 400);
    const fit = String(form.get("fit") ?? "");
    const color = String(form.get("color") ?? "");
    const name = String(form.get("name") ?? "").trim().slice(0, 80) || "Prenda sin nombre";
    const coverSource = String(form.get("coverSource") ?? "manual") === "openai" ? "openai" : "manual";

    if (!CATEGORIES.has(category)) return NextResponse.json({ error: "Categoría inválida" }, { status: 400 });
    if (!(front instanceof File) || !(back instanceof File)) {
      return NextResponse.json({ error: "Faltan las imágenes de frente y espalda" }, { status: 400 });
    }

    const files: { key: string; file: File }[] = [
      { key: "front", file: front },
      { key: "back", file: back },
    ];
    if (side instanceof File) files.push({ key: "side", file: side });

    for (const { file } of files) {
      if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: "Usá PNG, JPG o WEBP" }, { status: 415 });
      if (file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Cada imagen debe pesar menos de 8 MB" }, { status: 413 });
    }

    const referenceId = crypto.randomUUID();
    const uploads = await Promise.all(
      files.map(async ({ key, file }) => {
        const storagePath = `${userData.user.id}/clothing-references/${referenceId}-${key}.${extensionFor(file)}`;
        const { error: uploadError } = await supabase.storage.from("avatars").upload(storagePath, await file.arrayBuffer(), {
          contentType: file.type,
          cacheControl: "3600",
          upsert: false,
        });
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from("avatars").getPublicUrl(storagePath);
        return { key, storagePath, publicUrl: data.publicUrl };
      }),
    );

    const frontUpload = uploads.find((upload) => upload.key === "front");
    if (!frontUpload) throw new Error("No se pudo guardar la portada de la pieza");

    const imageUrls = uploads.map((upload) => upload.publicUrl);
    const fitLabel = fit ? `Fit: ${fit}.` : "";
    const colorLabel = color ? `Main color: ${color}.` : "";
    const texturePrompt = [BASE_STYLE_PROMPT, fitLabel, colorLabel, description].filter(Boolean).join(" ").slice(0, 600);

    const taskId = await createMultiImageTask(imageUrls, texturePrompt);
    const itemId = crypto.randomUUID();

    const { data: item, error: insertError } = await supabase
      .from("clothing_items")
      .insert({
        id: itemId,
        user_id: userData.user.id,
        name,
        category,
        fit: fit || null,
        color: color || null,
        status: "generating",
        prompt: texturePrompt,
        front_reference_url: frontUpload.publicUrl,
        back_reference_url: uploads.find((upload) => upload.key === "back")?.publicUrl,
        side_reference_url: uploads.find((upload) => upload.key === "side")?.publicUrl ?? null,
        // La vista frontal aprobada, generada por OpenAI o subida manualmente,
        // queda como portada oficial de la pieza y se guarda en la base.
        thumbnail_url: frontUpload.publicUrl,
        meshy_task_id: taskId,
        metadata: {
          reference_paths: uploads.map((upload) => upload.storagePath),
          cover_image_url: frontUpload.publicUrl,
          cover_source: coverSource,
          cover_view: "front",
        },
      })
      .select("id,name,category,status,thumbnail_url,meshy_task_id,created_at")
      .single();
    if (insertError) throw insertError;

    return NextResponse.json({ taskId, item, coverUrl: frontUpload.publicUrl });
  } catch (error) {
    console.error("Clothing generation failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo iniciar la generación" },
      { status: 500 },
    );
  }
}
