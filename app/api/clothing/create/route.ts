import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createMultiImageTask, createPreviewTask } from "@/lib/meshy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const CATEGORIES = new Set(["hoodie", "shirt", "jacket", "pants", "shorts", "shoes", "accessory"]);

const CATEGORY_PROMPTS: Record<string, string> = {
  hoodie: "A standalone hoodie garment only, hollow inside, with a clean neck opening, two sleeves, torso shell, cuffs and hem. No human body.",
  shirt: "A standalone T-shirt garment only, hollow inside, with neck opening, sleeves and torso shell. No human body.",
  jacket: "A standalone jacket garment only, hollow inside, with openable front, sleeves, cuffs and collar. No human body.",
  pants: "Standalone pants only, hollow inside, with waistband and two separated pant legs. No human body.",
  shorts: "Standalone shorts only, hollow inside, with waistband and two separated leg openings. No human body.",
  shoes: "A standalone matched pair of shoes only. No feet, legs or human body.",
  accessory: "A standalone wearable accessory only. No mannequin, no human body and no unrelated geometry.",
};

const BASE_STYLE_PROMPT = [
  "Create ONLY the requested wearable garment as an isolated 3D asset.",
  "Do not generate a person, mannequin, skin, head, hair, face, hands, arms, legs, feet or full body.",
  "The garment must be hollow and wearable, centered at the world origin, upright, symmetrical and facing forward.",
  "Use clean connected topology, realistic cloth thickness, closed seams and no floating fragments.",
  "Game-ready stylized streetwear for a cute mobile-game avatar.",
  "Do not merge the garment with an invisible body and do not create a robe-like solid sheet.",
].join(" ");

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) throw new Error("Missing Supabase server credentials");
  return createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
}

function extensionFor(file: File) {
  return file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
}

function garmentPrompt(category: string, fit: string, color: string, description: string) {
  return [
    BASE_STYLE_PROMPT,
    CATEGORY_PROMPTS[category] ?? CATEGORY_PROMPTS.accessory,
    fit ? `Fit: ${fit}.` : "",
    color ? `Main color: ${color}.` : "",
    description,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 1000);
}

async function uploadOptionalArt(
  supabase: ReturnType<typeof getAdminClient>,
  userId: string,
  itemId: string,
  art: File | null,
) {
  if (!art || art.size === 0) return null;
  if (!ALLOWED_TYPES.has(art.type)) throw new Error("El arte debe ser PNG, JPG o WEBP");
  if (art.size > MAX_IMAGE_BYTES) throw new Error("El arte debe pesar menos de 8 MB");

  const storagePath = `${userId}/clothing-art/${itemId}.${extensionFor(art)}`;
  const { error } = await supabase.storage.from("avatars").upload(storagePath, await art.arrayBuffer(), {
    contentType: art.type,
    cacheControl: "3600",
    upsert: true,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("avatars").getPublicUrl(storagePath);
  return { storagePath, publicUrl: data.publicUrl };
}

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
    if (!accessToken) return NextResponse.json({ error: "Missing access token" }, { status: 401 });

    const supabase = getAdminClient();
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData.user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const body = await request.json();
      const category = String(body?.category ?? "");
      const description = String(body?.description ?? "").trim().slice(0, 500);
      const fit = String(body?.fit ?? "").slice(0, 40);
      const color = String(body?.color ?? "").slice(0, 40);
      const name = String(body?.name ?? "").trim().slice(0, 80) || "Prenda CLOUVA";

      if (!CATEGORIES.has(category)) return NextResponse.json({ error: "Categoría inválida" }, { status: 400 });
      if (!description) return NextResponse.json({ error: "Describí la prenda que querés crear" }, { status: 400 });

      const prompt = garmentPrompt(category, fit, color, description);
      const taskId = await createPreviewTask(prompt, "cartoon");
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
          prompt,
          meshy_task_id: taskId,
          metadata: {
            generation_kind: "text-to-3d",
            generation_stage: "preview",
            isolated_garment_prompt_version: 3,
            official_avatar: "clouva-official-v1",
          },
        })
        .select("id,name,category,status,thumbnail_url,meshy_task_id,created_at")
        .single();
      if (insertError) throw insertError;

      return NextResponse.json({ taskId, item, kind: "text-to-3d", stage: "preview" });
    }

    const form = await request.formData();
    const front = form.get("front");
    const back = form.get("back");
    const side = form.get("side");
    const art = form.get("art");
    const category = String(form.get("category") ?? "");
    const description = String(form.get("description") ?? "").slice(0, 400);
    const fit = String(form.get("fit") ?? "");
    const color = String(form.get("color") ?? "");
    const name = String(form.get("name") ?? "").trim().slice(0, 80) || "Prenda sin nombre";

    if (!CATEGORIES.has(category)) return NextResponse.json({ error: "Categoría inválida" }, { status: 400 });

    // Nuevo flujo principal: si no hay vistas de referencia, Meshy genera directamente desde texto.
    if (!(front instanceof File) || !(back instanceof File)) {
      if (!description.trim()) return NextResponse.json({ error: "Describí la prenda que querés crear" }, { status: 400 });
      const itemId = crypto.randomUUID();
      const artUpload = await uploadOptionalArt(supabase, userData.user.id, itemId, art instanceof File ? art : null);
      const prompt = garmentPrompt(category, fit, color, description);
      const taskId = await createPreviewTask(prompt, "cartoon");

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
          prompt,
          thumbnail_url: artUpload?.publicUrl ?? null,
          meshy_task_id: taskId,
          metadata: {
            generation_kind: "text-to-3d",
            generation_stage: "preview",
            art_url: artUpload?.publicUrl ?? null,
            art_path: artUpload?.storagePath ?? null,
            art_usage: artUpload ? "texture-source" : null,
            isolated_garment_prompt_version: 3,
            official_avatar: "clouva-official-v1",
          },
        })
        .select("id,name,category,status,thumbnail_url,meshy_task_id,created_at")
        .single();
      if (insertError) throw insertError;

      return NextResponse.json({ taskId, item, kind: "text-to-3d", stage: "preview" });
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

    const prompt = garmentPrompt(category, fit, color, description);
    const taskId = await createMultiImageTask(uploads.map((upload) => upload.publicUrl), prompt);
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
        prompt,
        front_reference_url: frontUpload.publicUrl,
        back_reference_url: uploads.find((upload) => upload.key === "back")?.publicUrl,
        side_reference_url: uploads.find((upload) => upload.key === "side")?.publicUrl ?? null,
        thumbnail_url: frontUpload.publicUrl,
        meshy_task_id: taskId,
        metadata: {
          generation_kind: "multi-image",
          reference_paths: uploads.map((upload) => upload.storagePath),
          isolated_garment_prompt_version: 3,
        },
      })
      .select("id,name,category,status,thumbnail_url,meshy_task_id,created_at")
      .single();
    if (insertError) throw insertError;

    return NextResponse.json({ taskId, item, kind: "multi-image" });
  } catch (error) {
    console.error("Clothing generation failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo iniciar la generación" },
      { status: 500 },
    );
  }
}
