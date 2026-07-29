import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import {
  GeminiImageError,
  generateImage,
  type GeminiAspectRatio,
  type GeminiImageModel,
} from "@/lib/gemini-image";
import { uploadGeneratedMedia } from "@/lib/gcs-media";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED_MODELS: GeminiImageModel[] = ["gemini-3.1-flash-image", "gemini-3-pro-image"];
const ALLOWED_ASPECT_RATIOS: GeminiAspectRatio[] = [
  "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9",
];
const MAX_REFERENCE_IMAGES = 10;

type RequestBody = {
  prompt?: string;
  referenceImageUrls?: string[];
  model?: string;
  aspectRatio?: string;
  pathPrefix?: string;
};

function getSupabase(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Faltan variables públicas de Supabase.");
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireAdmin(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!accessToken) throw new Error("Sesión requerida.");

  const supabase = getSupabase(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Sesión inválida.");

  const allowed = (process.env.CLOUVA_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const email = data.user.email?.toLowerCase();
  if (!email || !allowed.includes(email)) {
    throw new Error("Usuario no autorizado para generar medios.");
  }
}

async function fetchAsInlineImage(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error(`Referencia inválida: ${url}`);

  const response = await fetch(parsed.toString());
  if (!response.ok) throw new Error(`No se pudo descargar la referencia (HTTP ${response.status}): ${url}`);

  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  const bytes = Buffer.from(await response.arrayBuffer());
  return { mimeType, data: bytes.toString("base64") };
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY no está configurada." }, { status: 500 });
    }

    const body = (await request.json()) as RequestBody;
    const prompt = body.prompt?.trim();
    if (!prompt) return NextResponse.json({ error: "Falta el prompt." }, { status: 400 });
    if (prompt.length > 4000) return NextResponse.json({ error: "El prompt es demasiado largo." }, { status: 413 });

    const referenceUrls = Array.isArray(body.referenceImageUrls) ? body.referenceImageUrls.slice(0, MAX_REFERENCE_IMAGES) : [];
    const model = ALLOWED_MODELS.includes(body.model as GeminiImageModel)
      ? (body.model as GeminiImageModel)
      : "gemini-3.1-flash-image";
    const aspectRatio = ALLOWED_ASPECT_RATIOS.includes(body.aspectRatio as GeminiAspectRatio)
      ? (body.aspectRatio as GeminiAspectRatio)
      : "1:1";
    const pathPrefix = body.pathPrefix?.replace(/[^a-zA-Z0-9/_-]/g, "").replace(/^\/+/, "") || "generated";

    const referenceImages = await Promise.all(referenceUrls.map(fetchAsInlineImage));

    const generated = await generateImage({
      apiKey,
      prompt,
      referenceImages,
      model,
      aspectRatio,
    });

    const url = await uploadGeneratedMedia({
      bytes: generated.bytes,
      mimeType: generated.mimeType,
      pathPrefix,
    });

    return NextResponse.json({ url, mimeType: generated.mimeType, text: generated.text, model });
  } catch (error) {
    if (error instanceof GeminiImageError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "No se pudo generar la imagen.";
    const status = /sesión|autorizado/i.test(message) ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
