import { NextRequest, NextResponse } from "next/server";
import {
  generateGoogleCloudJson,
  GoogleCloudGenAIError,
} from "@/lib/server/google-cloud-genai";
import { requireSpotAccess } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CHANNELS = new Set(["clouva_market", "facebook_marketplace", "facebook_group"]);

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
  },
  required: ["title", "description"],
} as const;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function publicError(error: unknown) {
  if (error instanceof GoogleCloudGenAIError) {
    return { status: error.status, message: error.message };
  }
  const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
  return {
    status,
    message: error instanceof Error ? error.message : "No se pudo generar el copy.",
  };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { id: productId } = await params;
    const body = (await request.json().catch(() => ({}))) as { channel?: string };
    const channel = String(body.channel || "");
    if (!CHANNELS.has(channel)) {
      return NextResponse.json({ error: "Canal de copy inválido." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { data: product, error } = await admin
      .from("commerce_products")
      .select("id,spot_id,name,description,price,currency,stock,product_type,listing_kind,metadata")
      .eq("id", productId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!product?.spot_id) return NextResponse.json({ error: "El producto no pertenece a un negocio comercial." }, { status: 404 });
    const { spot } = await requireSpotAccess({ admin, userId: user.id, spotId: product.spot_id, capability: "content" });

    const metadata = record(product.metadata);
    const recognition = record(metadata.recognition);
    const factual = {
      name: product.name,
      description: product.description || "",
      price: Number(product.price),
      currency: product.currency,
      stock: product.stock,
      productType: product.product_type,
      listingKind: product.listing_kind,
      recognition: {
        brand: recognition.brand ?? null,
        category: recognition.category ?? null,
        color: recognition.color ?? null,
        size: recognition.size ?? null,
        presentation: recognition.presentation ?? null,
      },
    };

    const style = channel === "facebook_group"
      ? "natural, breve y directo, como una publicación real de compra/venta; sin exageraciones ni hashtags innecesarios"
      : channel === "facebook_marketplace"
        ? "comercial, claro, escaneable y directo para Facebook Marketplace"
        : "ordenado, premium y descriptivo para CLOUVA Market";

    const prompt = [
      "Sos el redactor de publicaciones comerciales de CLOUVA.",
      `Negocio vendedor: ${spot.name}.`,
      `Canal: ${channel}.`,
      `Estilo: ${style}.`,
      "Generá un título y una descripción en español argentino.",
      "Usá SOLAMENTE los datos objetivos del JSON. No inventes marca, modelo, condición, garantía, accesorios, medidas, especificaciones, disponibilidad ni beneficios.",
      "Si un dato no está confirmado, simplemente no lo menciones.",
      "No cambies el precio ni la cantidad de stock.",
      "No digas que el producto es nuevo/usado/excelente estado salvo que el JSON lo confirme explícitamente.",
      JSON.stringify(factual),
    ].join("\n");

    const model = process.env.GOOGLE_CLOUD_PUBLICATION_COPY_MODEL
      ?? process.env.GEMINI_MODEL
      ?? "gemini-2.5-flash";
    const generated = await generateGoogleCloudJson({
      model,
      prompt,
      responseJsonSchema: RESPONSE_SCHEMA,
      temperature: 0.25,
      maxOutputTokens: 900,
    });

    let parsed: { title?: unknown; description?: unknown };
    try {
      parsed = JSON.parse(generated.text) as typeof parsed;
    } catch {
      return NextResponse.json({ error: "No se pudo interpretar el copy de Vertex AI." }, { status: 502 });
    }

    const title = typeof parsed.title === "string" ? parsed.title.trim().slice(0, 300) : "";
    const description = typeof parsed.description === "string" ? parsed.description.trim().slice(0, 5000) : "";
    if (!title || !description) {
      return NextResponse.json({ error: "Vertex AI devolvió un copy incompleto." }, { status: 502 });
    }

    return NextResponse.json({
      title,
      description,
      provider: generated.provider,
      model: generated.model,
      channel,
      usage: generated.usage,
    });
  } catch (error) {
    const mapped = publicError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
