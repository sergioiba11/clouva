import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createPreviewTask } from "@/lib/meshy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORIES: Record<string, string> = {
  hoodie: "complete separate hoodie garment",
  shirt: "complete separate T-shirt garment",
  jacket: "complete separate jacket garment",
  pants: "complete separate pair of baggy pants",
  shorts: "complete separate pair of shorts",
  shoes: "complete separate pair of sneakers",
  accessory: "complete separate wearable fashion accessory",
};

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan credenciales de Supabase");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Iniciá sesión" }, { status: 401 });

    const supabase = getAdminClient();
    const { data: auth, error: authError } = await supabase.auth.getUser(token);
    if (authError || !auth.user) return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });

    const body = await request.json();
    const category = String(body.category || "");
    const garment = CATEGORIES[category];
    if (!garment) return NextResponse.json({ error: "Categoría inválida" }, { status: 400 });

    const name = String(body.name || "Pieza CLOUVA").trim().slice(0, 80);
    const fit = String(body.fit || "Normal").slice(0, 30);
    const color = String(body.color || "#111111").slice(0, 20);
    const description = String(body.description || "").trim().slice(0, 600);
    const textureDetails = String(body.textureDetails || "").trim().slice(0, 400);
    if (!description) return NextResponse.json({ error: "Describí la forma de la pieza" }, { status: 400 });

    const m = body.measurements || {};
    const dimensions = `Target avatar measurements in normalized meters: full avatar height ${Number(m.height || 2.05).toFixed(3)}, target slot width ${Number(m.slotWidth || m.width || 0.65).toFixed(3)}, slot height ${Number(m.slotHeight || 0.8).toFixed(3)}, slot depth ${Number(m.slotDepth || m.depth || 0.35).toFixed(3)}.`;
    const textureInstruction = textureDetails
      ? `TEXTURE STAGE: main material color ${color}. Surface and graphic details: ${textureDetails}. Apply these only as material, print, embroidery, patch or surface treatment. Never change the requested garment category or turn a logo into geometry.`
      : `TEXTURE STAGE: use a clean premium material in ${color}, with subtle realistic fabric detail and no logos.`;

    const prompt = `GEOMETRY STAGE: Create a ${garment} for the CLOUVA stylized game avatar. Fit: ${fit}. Shape and construction description: ${description}. ${dimensions} Generate ONLY the wearable object as a separate mesh, never a character or mannequin. Respect the avatar proportions and leave practical clearance so it can be placed over the body without severe clipping. Keep the object centered at world origin, upright, symmetrical where appropriate, game-ready, mobile-friendly, clean topology, complete front/back/side volume, no floor, no environment, no floating logos, no body parts. ${textureInstruction}`;

    const taskId = await createPreviewTask(prompt, "cartoon");
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
          avatar_measurements: m,
          geometry_description: description,
          texture_details: textureDetails || null,
          texture_stage_enabled: true,
          artwork_enabled: false,
          openai_enabled: false,
        },
      })
      .select("id,name,category,status,meshy_task_id,created_at")
      .single();

    if (insertError) throw insertError;
    return NextResponse.json({ taskId, item });
  } catch (error) {
    console.error("Text clothing generation failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo iniciar Meshy" }, { status: 500 });
  }
}
