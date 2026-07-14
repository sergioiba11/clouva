import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const IMAGE_MODEL = "gpt-image-1.5";
const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
const ALLOWED_ARTWORK_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

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

function friendlyOpenAiError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("billing hard limit") || normalized.includes("insufficient_quota")) {
    return "La cuenta de OpenAI API llegó al límite de facturación. Aumentá el presupuesto o agregá saldo en la plataforma de OpenAI y volvé a intentar.";
  }
  return message;
}

async function parseImageResponse(response: Response) {
  const raw = await response.text();
  let data: any = {};
  try { data = JSON.parse(raw); } catch { data = { error: { message: raw } }; }
  if (!response.ok) throw new Error(friendlyOpenAiError(data?.error?.message || `OpenAI respondió ${response.status}`));
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI no devolvió la imagen de referencia");
  return Buffer.from(b64, "base64");
}

async function generateImage(prompt: string) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${openAiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt, size: "1024x1024", quality: "medium", output_format: "png" }),
  });
  return parseImageResponse(response);
}

async function editFromImage(imageBytes: Uint8Array, imageType: string, filename: string, prompt: string) {
  const form = new FormData();
  form.append("model", IMAGE_MODEL);
  form.append("image", new Blob([imageBytes], { type: imageType }), filename);
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

    const form = await request.formData();
    const category = String(form.get("category") || "hoodie");
    const garment = CATEGORY_LABELS[category] || CATEGORY_LABELS.accessory;
    const name = String(form.get("name") || "CLOUVA wearable").slice(0, 80);
    const fit = String(form.get("fit") || "Normal").slice(0, 30);
    const color = String(form.get("color") || "#111111").slice(0, 20);
    const description = String(form.get("description") || "").slice(0, 600);
    const artwork = form.get("artwork");

    let m: any = {};
    try { m = JSON.parse(String(form.get("measurements") || "{}")); } catch { m = {}; }

    if (artwork instanceof File) {
      if (!ALLOWED_ARTWORK_TYPES.has(artwork.type)) return NextResponse.json({ error: "La imagen de detalle debe ser PNG, JPG o WEBP" }, { status: 415 });
      if (artwork.size > MAX_ARTWORK_BYTES) return NextResponse.json({ error: "La imagen de detalle debe pesar menos de 8 MB" }, { status: 413 });
    }

    const measurementText = `Avatar mold dimensions in normalized meters: full height ${Number(m.height || 2.05).toFixed(3)}, body width ${Number(m.width || 0.65).toFixed(3)}, body depth ${Number(m.depth || 0.35).toFixed(3)}, target slot width ${Number(m.slotWidth || m.width || 0.65).toFixed(3)}, slot height ${Number(m.slotHeight || 0.8).toFixed(3)}, slot depth ${Number(m.slotDepth || m.depth || 0.35).toFixed(3)}.`;
    const designId = crypto.randomUUID();
    const commonRules = `The CATEGORY defines the complete physical object. The uploaded image is ONLY an artwork, logo, print, patch, embroidery, texture or visual-detail reference. Never turn the uploaded image into the whole object. Show the entire wearable from edge to edge. No isolated logo, no floating symbol, no poster, no graphic-only output. Neutral light-gray background, even studio lighting, no person, mannequin, hanger, labels, floor or dramatic perspective. Keep the design suitable for multi-view 3D reconstruction.`;

    const frontPrompt = `Create the MASTER FRONT reference for one ${garment}, design name ${name}. Strict orthographic FRONT view. Fit: ${fit}. Main color: ${color}. Artist request: ${description || "minimal premium CLOUVA streetwear"}. ${measurementText} ${commonRules} Apply the uploaded artwork only where the artist request logically places it. The complete garment must remain the dominant subject.`;

    let artworkPath: string | null = null;
    let artworkUrl: string | null = null;
    let frontBytes: Buffer;

    if (artwork instanceof File) {
      const artworkBytes = new Uint8Array(await artwork.arrayBuffer());
      frontBytes = await editFromImage(artworkBytes, artwork.type, artwork.name || "artwork.png", frontPrompt);
      const extension = artwork.type === "image/png" ? "png" : artwork.type === "image/webp" ? "webp" : "jpg";
      artworkPath = `${auth.user.id}/clothing-artwork/${designId}.${extension}`;
      const { error: artworkUploadError } = await supabase.storage.from("avatars").upload(artworkPath, artworkBytes, { contentType: artwork.type, cacheControl: "3600", upsert: false });
      if (artworkUploadError) throw artworkUploadError;
      artworkUrl = supabase.storage.from("avatars").getPublicUrl(artworkPath).data.publicUrl;
    } else {
      frontBytes = await generateImage(frontPrompt);
    }

    const backPrompt = `Using the supplied front image as the canonical design reference, generate the exact SAME ${garment} from a strict orthographic BACK view. Preserve silhouette, proportions, material, color, seams and construction. Respect the artist request for placement of logos or artwork. Graphics remain decoration only. Show the complete object on the same neutral background.`;
    const sidePrompt = `Using the supplied front image as the canonical design reference, generate the exact SAME ${garment} from a strict orthographic LEFT SIDE view. Preserve silhouette, thickness, proportions, material, color, seams and construction. Respect the artwork as decoration only. Show the complete object on the same neutral background.`;

    const safeFront = Uint8Array.from(frontBytes);
    const [backBytes, sideBytes] = await Promise.all([
      editFromImage(safeFront, "image/png", "front-reference.png", backPrompt),
      editFromImage(safeFront, "image/png", "front-reference.png", sidePrompt),
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
      artworkUrl,
      artworkPath,
      measurements: m,
      generationMode: artworkUrl ? "artwork-conditioned-master-front" : "text-master-front",
    });
  } catch (error) {
    console.error("AI clothing reference generation failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron generar las referencias" }, { status: 500 });
  }
}
