import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  extractJsonValue,
  normalizeBusinessRequestType,
  sanitizeBusinessAnalysis,
} from "@/lib/commerce/business-copilot";
import { generateWithFallback, selectedModelFromRequest } from "@/lib/clouva-ai/gemini-text";
import { requireSpotAccess } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const IMAGE_BUCKET = "business-reference-images";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

type BusinessRequestRow = {
  id: string;
  spot_id: string;
  created_by: string;
  request_type: string;
  status: string;
  title: string;
  input_text: string | null;
  reference_image_path: string | null;
  intent: Record<string, unknown>;
  plan: Array<Record<string, unknown>>;
  sourcing_result: Record<string, unknown>;
  decision_context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

function apiStatus(error: unknown) {
  return (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
}

function short(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function extensionForMime(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "jpg";
}

async function signedImage(admin: ReturnType<typeof createAdminSupabase>, path: string | null) {
  if (!path) return null;
  const { data, error } = await admin.storage.from(IMAGE_BUCKET).createSignedUrl(path, 60 * 60);
  if (error) return null;
  return data.signedUrl;
}

async function requestView(admin: ReturnType<typeof createAdminSupabase>, row: BusinessRequestRow) {
  return { ...row, reference_image_url: await signedImage(admin, row.reference_image_path) };
}

async function readCreateInput(request: NextRequest) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const imageValue = form.get("image");
    return {
      text: short(form.get("text"), 6000),
      requestType: normalizeBusinessRequestType(form.get("requestType")),
      image: imageValue instanceof File && imageValue.size > 0 ? imageValue : null,
    };
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  return {
    text: short(body.text, 6000),
    requestType: normalizeBusinessRequestType(body.requestType),
    image: null as File | null,
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ spotId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spotId } = await params;
    const admin = createAdminSupabase();
    const access = await requireSpotAccess({ admin, userId: user.id, spotId, capability: "view" });

    const { data: rows, error } = await admin
      .from("business_requests")
      .select("*")
      .eq("spot_id", spotId)
      .order("updated_at", { ascending: false })
      .limit(40);
    if (error) throw new Error(error.message);

    const requests = await Promise.all(((rows ?? []) as BusinessRequestRow[]).map((row) => requestView(admin, row)));
    const ids = requests.map((row) => row.id);
    let candidates: Array<Record<string, unknown>> = [];
    if (ids.length) {
      const candidateResult = await admin
        .from("business_sourcing_candidates")
        .select("*")
        .in("request_id", ids)
        .order("rank", { ascending: true });
      if (candidateResult.error) throw new Error(candidateResult.error.message);
      candidates = candidateResult.data ?? [];
    }

    return NextResponse.json({
      spot: {
        id: access.spot.id,
        name: access.spot.name,
        business_type: access.spot.business_type,
        business_categories: access.spot.business_categories,
        brand_tone: access.spot.brand_tone,
        country_code: access.spot.country_code,
        currency: access.spot.currency,
        timezone: access.spot.timezone,
        accent_color: access.spot.accent_color,
      },
      role: access.role,
      requests,
      candidates,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cargar Business AI." }, { status: apiStatus(error) });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ spotId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spotId } = await params;
    const admin = createAdminSupabase();
    const access = await requireSpotAccess({ admin, userId: user.id, spotId, capability: "operations" });
    const input = await readCreateInput(request);

    if (!input.text && !input.image) {
      return NextResponse.json({ error: "Escribí el pedido o adjuntá una imagen." }, { status: 400 });
    }
    if (input.image && (!IMAGE_TYPES.has(input.image.type) || input.image.size > MAX_IMAGE_BYTES)) {
      return NextResponse.json({ error: "La referencia debe ser JPG, PNG, WEBP o GIF y pesar hasta 8 MB." }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY no está configurada." }, { status: 503 });

    const imageBytes = input.image ? Buffer.from(await input.image.arrayBuffer()) : null;
    const knowledge = await admin.rpc("clouva_resolve_knowledge_context", {
      p_user_id: user.id,
      p_query: input.text || "operación de negocio desde una imagen",
      p_studio_id: access.spot.studio_id ?? null,
      p_limit: 6,
    });

    const businessContext = {
      spot: {
        name: access.spot.name,
        businessType: access.spot.business_type,
        categories: access.spot.business_categories,
        brandTone: access.spot.brand_tone,
        countryCode: access.spot.country_code,
        currency: access.spot.currency,
        timezone: access.spot.timezone,
      },
      knownContext: knowledge.error ? null : knowledge.data,
    };

    const parts: Array<Record<string, unknown>> = [{
      text: [
        `TIPO DE OPERACIÓN: ${input.requestType}`,
        `PEDIDO DEL PLAYER: ${input.text || "Usá la imagen como pedido principal."}`,
        `CONTEXTO DEL NEGOCIO: ${JSON.stringify(businessContext)}`,
        "Devolvé únicamente JSON válido con este contrato:",
        JSON.stringify({
          title: "título corto de la operación",
          intent: {
            objective: "qué hay que lograr",
            item: "producto/activo principal",
            category: "categoría",
            descriptors: ["rasgos útiles para buscar"],
            visibleText: ["texto/logos visibles, sólo como pista visual"],
            quantity: null,
            targetPrice: null,
            destination: null,
            constraints: ["restricciones reales conocidas"],
            unknowns: ["datos que todavía faltan"],
            searchQueries: ["consultas concretas de búsqueda, priorizando mayorista/proveedor si corresponde"],
          },
          plan: [{ key: "source", label: "Buscar opciones", detail: "acción concreta", status: "ready" }],
        }),
      ].join("\n\n"),
    }];
    if (imageBytes && input.image) {
      parts.push({ inlineData: { mimeType: input.image.type, data: imageBytes.toString("base64") } });
    }

    const model = selectedModelFromRequest(request);
    const generated = await generateWithFallback({
      apiKey,
      selectedModel: model,
      instruction: [
        "Sos Business Player de CLOUVA, la capa operativa de Mi Spot.",
        "Convertís pedidos informales, fotos y contexto del negocio en operaciones estructuradas y ejecutables.",
        "No inventes precio, material, autenticidad, stock, proveedor, ubicación ni cantidad.",
        "Si una imagen muestra texto o una marca, registralo sólo como visibleText/pista visual; no afirmes autenticidad.",
        "Diferenciá lo observado de lo que falta confirmar.",
        "El plan debe aprovechar el contexto del Player/Spot sin reemplazar datos canónicos por inferencias.",
        "Para sourcing/procurement incluí source, compare, decision, logistics e inventory cuando sean relevantes.",
        "Para listing, logistics u operations generá pasos específicos del objetivo.",
        "Respondé sólo JSON válido, sin markdown.",
      ].join("\n"),
      contents: [{ role: "user", parts }],
      maxOutputTokens: 2600,
      temperature: 0.2,
    });

    const analysis = sanitizeBusinessAnalysis(extractJsonValue(generated.text));
    const requestId = randomUUID();
    let imagePath: string | null = null;
    if (imageBytes && input.image) {
      imagePath = `${spotId}/${requestId}/reference.${extensionForMime(input.image.type)}`;
      const upload = await admin.storage.from(IMAGE_BUCKET).upload(imagePath, imageBytes, {
        contentType: input.image.type,
        cacheControl: "3600",
        upsert: false,
      });
      if (upload.error) throw new Error(upload.error.message);
    }

    const { data: created, error: insertError } = await admin
      .from("business_requests")
      .insert({
        id: requestId,
        spot_id: spotId,
        created_by: user.id,
        request_type: input.requestType,
        status: "analyzed",
        title: analysis.title,
        input_text: input.text || null,
        reference_image_path: imagePath,
        intent: analysis.intent,
        plan: analysis.plan,
        metadata: {
          analyzer: "gemini",
          model: generated.model,
          usage: generated.usage,
          source: input.image ? "text_image" : "text",
        },
      })
      .select("*")
      .single();
    if (insertError) {
      if (imagePath) await admin.storage.from(IMAGE_BUCKET).remove([imagePath]);
      throw new Error(insertError.message);
    }

    await admin.from("business_request_events").insert({
      request_id: requestId,
      actor_user_id: user.id,
      event_type: "analyzed",
      data: { requestType: input.requestType, model: generated.model },
    });

    return NextResponse.json({ request: await requestView(admin, created as BusinessRequestRow) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo analizar el pedido." }, { status: apiStatus(error) });
  }
}
