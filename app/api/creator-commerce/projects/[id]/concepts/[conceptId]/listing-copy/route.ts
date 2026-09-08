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
    title: { type: "string" },
    shortDescription: { type: "string" },
    description: { type: "string" },
    features: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
    caption: { type: "string" },
  },
  required: ["title", "shortDescription", "description", "features", "tags", "caption"],
} as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function textArray(value: unknown, maxItems: number, maxLength: number) {
  return Array.isArray(value)
    ? value.map((item) => text(item, maxLength)).filter(Boolean).slice(0, maxItems)
    : [];
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; conceptId: string }> },
) {
  try {
    const { supabase } = await requireUser(request);
    const { id, conceptId } = await params;
    const [projectResult, conceptResult, productResult] = await Promise.all([
      supabase.from("commerce_creator_projects").select("id,name,collection_name,brief,design_system").eq("id", id).maybeSingle(),
      supabase.from("commerce_creator_product_concepts").select("id,name,product_template,creative_config,design_overrides").eq("id", conceptId).eq("project_id", id).maybeSingle(),
      supabase.from("commerce_products").select("id,name,description,price,currency,stock,product_type,listing_kind,metadata").eq("creator_concept_id", conceptId).maybeSingle(),
    ]);
    if (projectResult.error) throw new Error(projectResult.error.message);
    if (conceptResult.error) throw new Error(conceptResult.error.message);
    if (productResult.error) throw new Error(productResult.error.message);
    if (!projectResult.data || !conceptResult.data) return NextResponse.json({ error: "No encontramos el producto creativo." }, { status: 404 });
    if (!productResult.data) return NextResponse.json({ error: "Prepará el producto en Commerce antes de generar su publicación." }, { status: 409 });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY no está configurada." }, { status: 500 });

    const facts = {
      product: {
        name: productResult.data.name,
        description: productResult.data.description || "",
        price: Number(productResult.data.price),
        currency: productResult.data.currency,
        stock: productResult.data.stock,
        productType: productResult.data.product_type,
        listingKind: productResult.data.listing_kind,
      },
      creator: {
        project: projectResult.data.name,
        collection: projectResult.data.collection_name,
        projectBrief: projectResult.data.brief,
        productTemplate: conceptResult.data.product_template,
        creativeConfig: record(conceptResult.data.creative_config),
        designOverrides: record(conceptResult.data.design_overrides),
      },
    };

    const prompt = [
      "Sos el redactor de CLOUVA Commerce Creator.",
      "Generá copy de publicación en español argentino para CLOUVA Market y una caption social breve.",
      "Usá SOLAMENTE los hechos del JSON. No inventes materiales, medidas, stock, calidad, envío, garantía, beneficios, disponibilidad ni especificaciones no confirmadas.",
      "No cambies precio, moneda ni stock. No hagas promesas de producción o entrega.",
      "El título debe ser comercial pero fiel al producto. Los tags deben ser útiles y concretos.",
      "Respondé exclusivamente con el JSON pedido.",
      JSON.stringify(facts),
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
            temperature: 0.3,
            maxOutputTokens: 1500,
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
    if (!output) return NextResponse.json({ error: "Gemini no devolvió copy." }, { status: 502 });

    let parsed: Record<string, unknown>;
    try { parsed = record(JSON.parse(output)); }
    catch { return NextResponse.json({ error: "No se pudo interpretar el copy de Gemini." }, { status: 502 }); }

    const listingCopy = {
      title: text(parsed.title, 300),
      shortDescription: text(parsed.shortDescription, 500),
      description: text(parsed.description, 5000),
      features: textArray(parsed.features, 10, 240),
      tags: textArray(parsed.tags, 16, 80),
      caption: text(parsed.caption, 1200),
      status: "draft",
      provider: "gemini",
      model,
      generated_at: new Date().toISOString(),
    };
    if (!listingCopy.title || !listingCopy.description) return NextResponse.json({ error: "Gemini devolvió un copy incompleto." }, { status: 502 });

    const saved = await supabase
      .from("commerce_creator_product_concepts")
      .update({ listing_copy: listingCopy, updated_at: new Date().toISOString() })
      .eq("id", conceptId)
      .eq("project_id", id)
      .select("listing_copy")
      .single();
    if (saved.error) throw new Error(saved.error.message);

    return NextResponse.json({ listingCopy: saved.data.listing_copy, persisted: true, published: false });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo generar el copy." }, { status });
  }
}
