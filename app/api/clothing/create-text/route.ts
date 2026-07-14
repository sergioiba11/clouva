import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createPreviewTask } from "@/lib/meshy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORY_OBJECTS: Record<string, string> = {
  hoodie: "complete standalone hoodie garment",
  shirt: "complete standalone T-shirt garment",
  jacket: "complete standalone jacket garment",
  pants: "complete standalone pair of baggy pants",
  shorts: "complete standalone pair of shorts",
  shoes: "complete standalone pair of sneakers",
  accessory: "complete standalone wearable fashion accessory",
};

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan credenciales de Supabase");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Iniciá sesión" }, { status: 401 });

    const supabase = adminClient();
    const { data: auth, error: authError } = await supabase.auth.getUser(token);
    if (authError || !auth.user) return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });

    const body = await request.json();
    const category = String(body.category || "");
    const garment = CATEGORY_OBJECTS[category];
    if (!garment) return NextResponse.json({ error: "Categoría inválida" }, { status: 400 });

    const name = String(body.name || "Pieza CLOUVA").trim().slice(0, 80);
    const fit = String(body.fit || "Normal").trim().slice(0, 30);
    const color = String(body.color || "#111111").trim().slice(0, 20);
    const description = String(body.description || "").trim().slice(0, 600);
    const textureDetails = String(body.textureDetails || "").trim().slice(0, 400);
    if (!description) return NextResponse.json({ error: "Describí la forma de la pieza" }, { status: 400 });

    const measurements = body.measurements || {};
    const dimensions = `Avatar slot dimensions in normalized meters: width ${Number(measurements.slotWidth || measurements.width || 0.65).toFixed(3)}, height ${Number(measurements.slotHeight || 0.8).toFixed(3)}, depth ${Number(measurements.slotDepth || measurements.depth || 0.35).toFixed(3)}.`;
    const texture = textureDetails
      ? `Surface finish: base color ${color}. ${textureDetails}. Logos, embroidery, prints and patches must remain surface details and must not become separate geometry.`
      : `Surface finish: clean premium fabric in ${color}, subtle textile detail, no logos.`;

    const prompt = `Create one ${garment} for a stylized mobile-game avatar. Fit: ${fit}. Shape and construction: ${description}. ${dimensions} Generate only the wearable object as a separate mesh. It must be animation-ready and suitable for automatic skinning to a humanoid skeleton: clean continuous topology, sensible edge flow around shoulders, elbows, hips and knees, separate but connected sleeves or legs where applicable, no fused body parts, no mannequin and no character. Keep the garment in a neutral A-pose compatible shape, upright, centered at world origin, symmetrical when appropriate, mobile-friendly, complete from front/back/side, with practical clearance for wearing over the avatar. Do not generate a floor, environment or floating symbols. ${texture}`;

    const taskId = await createPreviewTask(prompt, "realistic");
    const itemId = crypto.randomUUID();

    const { data: item, error: insertError } = await supabase
      .from("clothing_items")
      .insert({
        id: itemId,
        user_id: auth.user.id,
        name,
        category,
        fit,
        color,
        status: "generating",
        prompt,
        meshy_task_id: taskId,
        metadata: {
          generation_source: "meshy_text_to_3d",
          avatar_measurements: measurements,
          geometry_description: description,
          texture_details: textureDetails || null,
          animation_ready_requested: true,
          auto_skin_enabled: true,
          openai_enabled: false,
        },
      })
      .select("id,name,category,status,meshy_task_id,created_at")
      .single();

    if (insertError) throw insertError;
    return NextResponse.json({ taskId, item });
  } catch (error) {
    console.error("Text garment generation failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo iniciar Meshy" }, { status: 500 });
  }
}
