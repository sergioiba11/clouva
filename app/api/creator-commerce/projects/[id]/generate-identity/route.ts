import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type GeminiPayload = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string };
};

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

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
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
    const assetHints = Array.isArray(project.reference_assets)
      ? project.reference_assets.slice(0, 8).map((asset) => {
          const item = record(asset);
          return { kind: text(item.kind, 60), label: text(item.label, 100) };
        })
      : [];

    const prompt = [
      "Sos el director de identidad visual de CLOUVA Commerce Creator.",
      "Tu trabajo es proponer un Design System editable para un drop de productos, no crear precios, stock ni decisiones comerciales.",
      "Respondé exclusivamente con el JSON pedido.",
      "Los colores deben ser HEX de 6 dígitos.",
      "campaignStyle debe ser uno de: urbano, estudio, editorial, minimal, premium, futurista.",
      "No inventes marcas externas. No copies identidades de terceros. Si el brief menciona una identidad propia, traducila a reglas visuales coherentes.",
      JSON.stringify({
        project: project.name,
        collection: project.collection_name,
        brief: project.brief,
        creativeMode: project.creative_mode,
        currentDesignSystem: current,
        availableIdentityAssets: assetHints,
      }),
    ].join("\n");

    const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.45,
            maxOutputTokens: 1200,
            responseMimeType: "application/json",
            responseJsonSchema: RESPONSE_SCHEMA,
          },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(45_000),
      },
    );
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
      campaignStyle: ["urbano", "estudio", "editorial", "minimal", "premium", "futurista"].includes(String(parsed.campaignStyle)) ? String(parsed.campaignStyle) : "urbano",
    };

    return NextResponse.json({ designSystem, provider: "gemini", model, persisted: false });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo generar la identidad." }, { status });
  }
}
