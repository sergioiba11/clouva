import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VIEWS = ["front", "back", "side"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  hoodie: "oversized hoodie",
  shirt: "shirt",
  jacket: "jacket",
  pants: "baggy pants",
  shorts: "shorts",
  shoes: "pair of sneakers",
  accessory: "fashion accessory",
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

async function generateImage(prompt: string) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1.5", prompt, size: "1024x1024", quality: "medium", output_format: "png" }),
  });
  const raw = await response.text();
  let data: any = {};
  try { data = JSON.parse(raw); } catch { data = { error: { message: raw } }; }
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI respondió ${response.status}`);
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI no devolvió la imagen de referencia");
  return Buffer.from(b64, "base64");
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

    const generated = await Promise.all(VIEWS.map(async (view) => {
      const viewInstruction = view === "front" ? "strict orthographic FRONT view" : view === "back" ? "strict orthographic BACK view" : "strict orthographic LEFT SIDE view";
      const prompt = `Create one clean technical product reference image for 3D reconstruction. Subject: ${garment}, design name ${name}. ${viewInstruction}. Fit: ${fit}. Main color: ${color}. Artist request: ${description || "minimal premium CLOUVA streetwear"}. ${measurementText} The garment must be shaped for these proportions and preserve practical openings and volume for fitting over the avatar. Show ONLY the separate wearable object, centered, complete, symmetrical where appropriate, neutral light-gray background, even studio lighting, no person, no mannequin, no body parts, no hanger, no text, no labels, no floor, no perspective distortion. Keep design details consistent with the other orthographic views.`;
      const bytes = await generateImage(prompt);
      const path = `${auth.user.id}/clothing-ai-references/${designId}-${view}.png`;
      const { error: uploadError } = await supabase.storage.from("avatars").upload(path, bytes, { contentType: "image/png", cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      return { view, url: data.publicUrl, path };
    }));

    return NextResponse.json({ designId, references: Object.fromEntries(generated.map((item) => [item.view, item.url])), measurements: m });
  } catch (error) {
    console.error("AI clothing reference generation failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron generar las referencias" }, { status: 500 });
  }
}
