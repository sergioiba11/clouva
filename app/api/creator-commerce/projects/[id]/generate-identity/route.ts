import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type GeminiPayload = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
};
type IdentityAsset = { kind?: unknown; label?: unknown; url?: unknown };
type InlinePart = { inlineData: { mimeType: string; data: string } };

const GENERATED_BUCKET = process.env.CLOUVA_GENERATED_MEDIA_BUCKET ?? "clouva-generated-media";
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const IDENTITY_KIND_PRIORITY = ["artwork_master", "logo", "cover", "artwork", "moodboard", "inspiration_reference", "reference"];
const MAX_IDENTITY_REFERENCES = 4;
const MAX_IDENTITY_BYTES = 8 * 1024 * 1024;
const CAMPAIGN_STYLES = ["urbano", "estudio", "calle", "editorial", "minimal", "premium", "futurista"];

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    primaryColor: { type: "string" },
    secondaryColor: { type: "string" },
    accentColor: { type: "string" },
    backgroundColor: { type: "string" },
    typographyDirection: { type: "string" },
    graphicLanguage: { type: "string" },
    textures: { type: "string" },
    mood: { type: "string" },
    compositionRules: { type: "string" },
    prohibitedElements: { type: "string" },
    campaignStyle: { type: "string" },
  },
  required: [
    "primaryColor", "secondaryColor", "accentColor", "backgroundColor",
    "typographyDirection", "graphicLanguage", "textures", "mood",
    "compositionRules", "prohibitedElements", "campaignStyle",
  ],
} as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function sanitizeHex(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const clean = value.trim();
  return /^#[0-9a-f]{6}$/i.test(clean) ? clean : fallback;
}
function text(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function trustedIdentityUrl(value: unknown) {
  const raw = text(value, 2000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== "storage.googleapis.com") return null;
    if (!url.pathname.startsWith(`/${GENERATED_BUCKET}/creator-commerce/`)) return null;
    return url.toString();
  } catch { return null; }
}
function orderedIdentityAssets(value: unknown): IdentityAsset[] {
  if (!Array.isArray(value)) return [];
  return (value as IdentityAsset[])
    .map((asset, index) => ({ asset, index, priority: IDENTITY_KIND_PRIORITY.indexOf(text(asset.kind, 80)) }))
    .sort((a, b) => (a.priority < 0 ? 99 : a.priority) - (b.priority < 0 ? 99 : b.priority) || a.index - b.index)
    .map(({ asset }) => asset)
    .slice(0, MAX_IDENTITY_REFERENCES);
}
async function loadInlinePart(asset: IdentityAsset): Promise<InlinePart | null> {
  const url = trustedIdentityUrl(asset.url);
  if (!url) return null;
  try {
    const response = await fetch(url, { cache: "force-cache", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() || "";
    if (!ALLOWED_MIME.has(mimeType)) return null;
    const declared = Number(response.headers.get("content-length") || "0");
    if (declared > MAX_IDENTITY_BYTES) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IDENTITY_BYTES) return null;
    return { inlineData: { mimeType, data: bytes.toString("base64") } };
  } catch { return null; }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requireUser(request);
    const { id } = await params;
    const { data: project, error } = await supabase
      .from("commerce_creator_projects")
      .select("id,name,collection_name,brief,creative_mode,design_system,reference_assets")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!project) return NextResponse.json({ error: "El proyecto no existe o no tenés permiso." }, { status: 404 });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY no está configurada." }, { status: 500 });
    const current = record(project.design_system);
    const identityAssets = orderedIdentityAssets(project.reference_assets);
    const assetHints = identityAssets.map((asset) => ({ kind: text(asset.kind, 60), label: text(asset.label, 100) }));
    const imageParts = (await Promise.all(identityAssets.map(loadInlinePart))).filter((part): part is InlinePart => Boolean(part));

    const prompt = [
      "Sos el director de identidad visual de CLOUVA Commerce Creator.",
      "Tu trabajo es proponer un Design System EDITABLE para un drop de productos, no crear precios, stock ni decisiones comerciales.",
      imageParts.length ? "También recibís imágenes propias del proyecto. Analizá su paleta, símbolos, composición, tipografía visible, texturas y lenguaje gráfico; no inventes que viste detalles que no son legibles." : "No hay imágenes legibles disponibles: basate en el brief y datos textuales.",
      project.creative_mode === "exact_design" ? "MODO DISEÑO EXACTO: tratá Artwork Master/logo/portada como identidad canónica. Describí reglas para PRESERVAR ese arte, no para reinterpretarlo." : "",
      "Respondé exclusivamente con el JSON pedido.",
      "Los colores deben ser HEX de 6 dígitos.",
      `campaignStyle debe ser uno de: ${CAMPAIGN_STYLES.join(", ")}.`,
      "No inventes marcas externas. No copies identidades de terceros. Si el brief menciona una identidad propia, traducila a reglas visuales coherentes.",
      JSON.stringify({ project: project.name, collection: project.collection_name, brief: project.brief, creativeMode: project.creative_mode, currentDesignSystem: current, availableIdentityAssets: assetHints }),
    ].filter(Boolean).join("\n");

    const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }, ...imageParts] }],
        generationConfig: { temperature: 0.45, maxOutputTokens: 1200, responseMimeType: "application/json", responseJsonSchema: RESPONSE_SCHEMA },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    const raw = await response.text();
    let payload: GeminiPayload = {};
    try { payload = raw ? JSON.parse(raw) as GeminiPayload : {}; }
    catch { return NextResponse.json({ error: "Gemini devolvió una respuesta inválida." }, { status: 502 }); }
    if (!response.ok) return NextResponse.json({ error: payload.error?.message ?? `Gemini respondió HTTP ${response.status}` }, { status: response.status });
    const output = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
    if (!output) return NextResponse.json({ error: "Gemini no devolvió una identidad." }, { status: 502 });

    let parsed: Record<string, unknown>;
    try { parsed = record(JSON.parse(output)); }
    catch { return NextResponse.json({ error: "No se pudo interpretar la identidad generada." }, { status: 502 }); }

    const designSystem = {
      primaryColor: sanitizeHex(parsed.primaryColor, "#7c3aed"),
      secondaryColor: sanitizeHex(parsed.secondaryColor, "#111111"),
      accentColor: sanitizeHex(parsed.accentColor, "#2563eb"),
      backgroundColor: sanitizeHex(parsed.backgroundColor, "#05030a"),
      typographyDirection: text(parsed.typographyDirection, 300),
      graphicLanguage: text(parsed.graphicLanguage, 500),
      textures: text(parsed.textures, 300),
      mood: text(parsed.mood, 300),
      compositionRules: text(parsed.compositionRules, 600),
      prohibitedElements: text(parsed.prohibitedElements, 400),
      campaignStyle: CAMPAIGN_STYLES.includes(String(parsed.campaignStyle)) ? String(parsed.campaignStyle) : "urbano",
    };

    return NextResponse.json({ designSystem, provider: "gemini", model, persisted: false, visualReferencesUsed: imageParts.length });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo generar la identidad." }, { status });
  }
}
