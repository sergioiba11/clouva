import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CATEGORY_LABELS: Record<string, string> = {
  hoodie: "complete hoodie",
  shirt: "complete T-shirt",
  jacket: "complete jacket",
  pants: "complete pair of baggy pants",
  shorts: "complete pair of shorts",
  shoes: "complete pair of sneakers",
  accessory: "complete wearable fashion accessory",
};

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan credenciales de Supabase");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function openAiKey() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("Falta configurar OPENAI_API_KEY en Vercel");
  return key;
}

async function parseImageResponse(response: Response) {
  const raw = await response.text();
  let data: any = {};
  try { data = JSON.parse(raw); } catch { data = { error: { message: raw } }; }
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI respondió ${response.status}`);
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI no devolvió la imagen de referencia");
  return Buffer.from(b64, "base64");
}

async function generateFront(prompt: string) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-2", prompt, size: "1024x1024", quality: "medium", output_format: "png" }),
  });
  return parseImageResponse(response);
}

async function generateMatchingView(frontBytes: Buffer, prompt: string) {
  const form = new FormData();
  form.append("model", "gpt-image-2");
  form.append("image[]", new Blob([frontBytes], { type: "image/png" }), "front-reference.png");
  form.append("prompt", prompt);
  form.append("size", "1024x1024");
  form.append("quality", "medium");
  form.append("output_format", "png");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey()}` },
    body: form,
  });
  return parseImageResponse(response);
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Iniciá sesión" }, { status: 401 });
    const supabase = adminClient();
    const { data: auth, error: authError } = await supabase.auth.getUser(token);
    if (authError || !auth.user) return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });

    const body = await request.json();
    const category = String(body.category || "hoodie");
    const garment = CATEGORY_LABELS[category] || CATEGORY_LABELS.accessory;
    const name = String(body.name || "CLOUVA wearable").slice(0, 80);
    const fit = String(body.fit || "Normal").slice(0, 30);
    const color = String(body.color || "#111111").slice(0, 20);
    const description = String(body.description || "").slice(0, 600);
    const m = body.measurements || {};
    const measurementText = `Avatar mold dimensions in normalized meters: full height ${Number(m.height || 2.05).toFixed(3)}, body width ${Number(m.width || 0.65).toFixed(3)}, body depth ${Number(m.depth || 0.35).toFixed(3)}, target slot width ${Number(m.slotWidth || m.width || 0.65).toFixed(3)}, slot height ${Number(m.slotHeight || 0.8).toFixed(3)}, slot depth ${Number(m.slotDepth || m.depth || 0.35).toFixed(3)}.`;
    const designId = crypto.randomUUID();

    const commonRules = `The CATEGORY defines the complete physical object. The artist description defines construction, silhouette, materials and visual details. Any logo, symbol, lettering or graphic mentioned by the artist is ONLY decoration printed, embroidered, patched or attached onto the garment; it must NEVER become the object itself. Show the entire wearable from edge to edge, including all sleeves, openings, soles, waistbands or straps that belong to it. No isolated logo, no floating symbol, no poster, no graphic-only output. The object must be suitable for multi-view 3D reconstruction, centered on a neutral light-gray background, evenly lit, with no person, mannequin, body parts, hanger, text labels, floor or dramatic perspective.`;

    const frontPrompt = `Create the MASTER FRONT reference for one ${garment}, design name ${name}. Strict orthographic FRONT view. Fit: ${fit}. Main color: ${color}. Artist request: ${description || "minimal premium CLOUVA streetwear"}. ${measurementText} ${commonRules} Make the complete garment shape the dominant subject. This front image will be used as the canonical design reference for the other views, so make every seam, panel, pocket, hood, lace, sole and decorative placement clear and production-friendly.`;
    const frontBytes = await generateFront(frontPrompt);

    const backPrompt = `Using the supplied front image as the canonical design reference, generate the exact SAME ${garment} from a strict orthographic BACK view. Preserve the same silhouette, proportions, material, color palette, seams, panels and construction. Infer a physically plausible back while keeping all artist-requested graphics in their correct role as decoration on the garment. Do not output a logo alone. Show the complete object, centered, neutral light-gray background, even studio light, no person, mannequin, body parts, hanger, text labels, floor or perspective distortion.`;
    const sidePrompt = `Using the supplied front image as the canonical design reference, generate the exact SAME ${garment} from a strict orthographic LEFT SIDE view. Preserve the same silhouette, thickness, proportions, material, color palette, seams, panels and construction. Infer realistic depth for the avatar mold. Graphics remain decoration only and must not replace the wearable. Show the complete object, centered, neutral light-gray background, even studio light, no person, mannequin, body parts, hanger, text labels, floor or perspective distortion.`;

    const [backBytes, sideBytes] = await Promise.all([
      generateMatchingView(frontBytes, backPrompt),
      generateMatchingView(frontBytes, sidePrompt),
    ]);

    const outputs = [
      { view: "front", bytes: frontBytes },
      { view: "back", bytes: backBytes },
      { view: "side", bytes: sideBytes },
    ] as const;

    const generated = await Promise.all(outputs.map(async ({ view, bytes }) => {
      const path = `${auth.user.id}/clothing-ai-references/${designId}-${view}.png`;
      const { error: uploadError } = await supabase.storage.from("avatars").upload(path, bytes, { contentType: "image/png", cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      return { view, url: data.publicUrl, path };
    }));

    return NextResponse.json({
      designId,
      references: Object.fromEntries(generated.map((item) => [item.view, item.url])),
      measurements: m,
      generationMode: "openai-master-front-plus-consistent-edits",
    });
  } catch (error) {
    console.error("AI clothing reference generation failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron generar las referencias" }, { status: 500 });
  }
}
