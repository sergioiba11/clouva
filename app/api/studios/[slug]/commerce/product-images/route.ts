import { NextRequest, NextResponse } from "next/server";
import {
  generateImage,
  GeminiImageError,
  type GeminiImageModel,
  type GeminiReferenceImage,
} from "@/lib/gemini-image";
import { uploadGeneratedMediaObject } from "@/lib/gcs-media";
import {
  canonicalProductCaptureLabel,
  countProductCaptureLabels,
  MAX_PRODUCT_DETAIL_IMAGES,
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PRODUCT_REFERENCE_IMAGES,
  MAX_PRODUCT_TOTAL_BYTES,
  orderProductCaptures,
  type ProductCaptureLabel,
} from "@/lib/commerce/product-capture-contract";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type CaptureLabel = ProductCaptureLabel;
type ProductCaptureInput = { label?: unknown; dataUrl?: unknown };
type ProductDraft = {
  name?: unknown;
  brand?: unknown;
  category?: unknown;
  description?: unknown;
  color?: unknown;
  size?: unknown;
  presentation?: unknown;
};
type IdentifierDraft = { value?: unknown; type?: unknown };
type ParsedCapture = {
  label: CaptureLabel;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  bytes: Buffer;
  base64: string;
};
type IndexedCapture = ParsedCapture & { detailIndex: number | null; displayLabel: string };
type GeneratedKind = "front_catalog" | "back_catalog";
type GenerationTarget = { kind: GeneratedKind; sourceLabel: "Frente" | "Atrás"; detailIndex: null };
type GeneratedProductImage = {
  kind: GeneratedKind;
  sourceLabel: "Frente" | "Atrás";
  detailIndex: null;
  url: string;
  storagePath: string;
  mimeType: string;
  model: GeminiImageModel;
};

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_MODELS = new Set<GeminiImageModel>([
  "gemini-3.1-flash-lite-image",
  "gemini-3.1-flash-image",
  "gemini-3-pro-image",
]);
const PRODUCT_IMAGE_GENERATION_TIMEOUT_MS = 150_000;

class ProductImageError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function shortText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseCapture(input: ProductCaptureInput, index: number): ParsedCapture {
  const label = canonicalProductCaptureLabel(input.label);
  if (!label) throw new ProductImageError(`La vista ${index + 1} no tiene un label válido.`);
  if (typeof input.dataUrl !== "string") throw new ProductImageError(`La vista ${label} no contiene una imagen.`);
  const match = input.dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) throw new ProductImageError(`La vista ${label} no tiene un formato válido.`);
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_MIME.has(mimeType)) throw new ProductImageError("Usá fotos JPG, PNG o WEBP.", 415);
  const base64 = match[2].replace(/\s/g, "");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > MAX_PRODUCT_IMAGE_BYTES) {
    throw new ProductImageError(`La vista ${label} debe pesar hasta 5 MB.`, 413);
  }
  return { label, mimeType: mimeType as ParsedCapture["mimeType"], bytes, base64 };
}

function indexCaptures(captures: ParsedCapture[]): IndexedCapture[] {
  let detailIndex = 0;
  return orderProductCaptures(captures).map((capture) => {
    const index = capture.label === "Detalle" ? ++detailIndex : null;
    return {
      ...capture,
      detailIndex: index,
      displayLabel: index ? `Detalle ${index}` : capture.label,
    };
  });
}

function productFacts(draft: ProductDraft | undefined, identifier: IdentifierDraft | undefined) {
  const fields = [
    ["nombre", shortText(draft?.name, 180)],
    ["marca", shortText(draft?.brand, 120)],
    ["categoría", shortText(draft?.category, 120)],
    ["color", shortText(draft?.color, 80)],
    ["talle", shortText(draft?.size, 80)],
    ["presentación", shortText(draft?.presentation, 160)],
  ].filter(([, value]) => value);
  const description = shortText(draft?.description, 600);
  const code = shortText(identifier?.value, 512);
  const codeType = shortText(identifier?.type, 32);
  return [
    fields.length ? `Ficha detectada: ${fields.map(([key, value]) => `${key}: ${value}`).join("; ")}.` : "",
    description ? `Descripción detectada: ${description}.` : "",
    code ? `Identificador ya confirmado: ${codeType || "código"} ${code}.` : "",
  ].filter(Boolean).join("\n");
}

function referencesForTarget(target: GenerationTarget, captures: IndexedCapture[]) {
  const primary = captures.find((capture) => capture.label === target.sourceLabel);
  if (!primary) return [];
  const support = captures.filter((capture) => capture !== primary);
  return [primary, ...support];
}

function generationPrompt(target: GenerationTarget, facts: string, referenceOrder: string[]) {
  return [
    "Sos el generador de imágenes de catálogo de producto de CLOUVA.",
    `La primera referencia es la vista ${target.sourceLabel} canónica y define el ángulo, frente/atrás y composición del producto.`,
    facts,
    referenceOrder.length ? `Referencias disponibles en orden: ${referenceOrder.join(", ")}.` : "",
    "OBJETIVO: producir una foto de catálogo limpia donde aparezca SOLO el producto, aislado sobre fondo blanco/neutro. No deben aparecer manos, dedos, brazos, personas, mesa, piso, silla, objetos del entorno ni props.",
    "REGLA DE IDENTIDAD: el producto final debe ser exactamente el mismo producto físico de las referencias. No rediseñes packaging, no cambies geometría, proporciones, apertura, bordes, pliegues, color, materiales, textura, logos, tipografías, códigos, QR, gráficos ni ningún texto visible.",
    "Usá la primera referencia para fijar la vista. Las referencias adicionales sirven SOLO como evidencia factual para recuperar partes del producto tapadas por la mano o por el entorno.",
    "Cuando una zona esté tapada por una mano, completala únicamente con información visual confirmada por otra referencia del mismo producto. No inventes ilustraciones, palabras, símbolos, piezas, pestañas ni contenido que no aparezca en ninguna referencia.",
    "Si varias referencias muestran la misma zona, respetá la coincidencia entre ellas. Priorizá textos y gráficos legibles de la referencia donde estén más claros.",
    "Eliminá por completo manos, dedos, brazos y cualquier elemento ajeno al producto. El resultado debe parecer una fotografía de estudio del producto solo, no un recorte con restos humanos.",
    "Podés reconstruir exclusivamente las áreas del producto que estaban físicamente ocultas por la mano usando evidencia de las otras referencias; fuera de esas áreas, no reinterpretés ni mejores el diseño.",
    "No agregues accesorios, sombras dramáticas, soportes, superficies, decoración, etiquetas nuevas, marcas de agua ni texto externo. Usá una sombra de apoyo mínima y realista solo para separar el producto del fondo.",
    target.kind === "front_catalog"
      ? "La salida es Frente: mantené una vista frontal coherente con la referencia Frente y no la conviertas en perspectiva de detalle."
      : "La salida es Atrás: mantené una vista trasera coherente con la referencia Atrás y no mezcles el diseño del frente.",
    "Antes de entregar, verificá: cero manos/personas visibles; solo producto; textos/logos preservados; sin piezas inventadas; misma identidad visual que las referencias.",
  ].filter(Boolean).join("\n");
}

function publicError(error: unknown) {
  if (error instanceof ProductImageError) return { status: error.status, message: error.message };
  if (error instanceof GeminiImageError) {
    const message = error.message || "Gemini no pudo editar las imágenes del producto.";
    if (/quota|resource exhausted|rate limit/i.test(message)) return { status: 429, message: "La cuota de Gemini para imágenes está agotada." };
    if (/billing|paid tier|payment/i.test(message)) return { status: 402, message: "La edición de imágenes de Gemini requiere facturación habilitada." };
    if (/abort|timeout|timed out/i.test(message)) return { status: 504, message: "Gemini superó el tiempo de espera editando la imagen." };
    return { status: error.status || 502, message };
  }
  const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
  return { status, message: error instanceof Error ? error.message : "No se pudieron editar las imágenes del producto." };
}

async function generateCatalogTarget(args: {
  target: GenerationTarget;
  apiKey: string;
  model: GeminiImageModel;
  facts: string;
  referenceOrder: string[];
  referenceImages: GeminiReferenceImage[];
  spotId: string;
}): Promise<GeneratedProductImage> {
  if (!args.referenceImages.length) throw new ProductImageError(`Falta la foto ${args.target.sourceLabel}.`);
  const generated = await generateImage({
    apiKey: args.apiKey,
    model: args.model,
    prompt: generationPrompt(args.target, args.facts, args.referenceOrder),
    referenceImages: args.referenceImages,
    aspectRatio: "1:1",
    imageSize: "1K",
    timeoutMs: PRODUCT_IMAGE_GENERATION_TIMEOUT_MS,
  });
  const stored = await uploadGeneratedMediaObject({
    bytes: generated.bytes,
    mimeType: generated.mimeType,
    pathPrefix: `commerce/${args.spotId}/product-generated`,
  });
  return {
    kind: args.target.kind,
    sourceLabel: args.target.sourceLabel,
    detailIndex: null,
    url: stored.url,
    storagePath: stored.objectPath,
    mimeType: generated.mimeType,
    model: args.model,
  };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      captures?: ProductCaptureInput[];
      productDraft?: ProductDraft;
      identifier?: IdentifierDraft | null;
    };

    if (!Array.isArray(body.captures) || body.captures.length < 1) {
      throw new ProductImageError("Capturá al menos el Frente del producto.");
    }
    if (body.captures.length > MAX_PRODUCT_REFERENCE_IMAGES) {
      throw new ProductImageError(`Podés usar hasta ${MAX_PRODUCT_REFERENCE_IMAGES} referencias del producto.`);
    }

    const parsedCaptures = body.captures.map(parseCapture);
    const counts = countProductCaptureLabels(parsedCaptures.map((capture) => capture.label));
    if (counts.front !== 1) throw new ProductImageError("Necesitás exactamente un Frente para generar imágenes de catálogo.");
    if (counts.back > 1) throw new ProductImageError("Podés usar como máximo una vista Atrás.");
    if (counts.detail > MAX_PRODUCT_DETAIL_IMAGES) {
      throw new ProductImageError(`Podés usar hasta ${MAX_PRODUCT_DETAIL_IMAGES} imágenes de Detalle.`);
    }

    const captures = indexCaptures(parsedCaptures);
    const totalBytes = captures.reduce((sum, capture) => sum + capture.bytes.length, 0);
    if (totalBytes > MAX_PRODUCT_TOTAL_BYTES) throw new ProductImageError("Las fotos juntas superan el máximo de 24 MB.", 413);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new ProductImageError("GEMINI_API_KEY no está configurada.", 500);

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const configuredModel = process.env.GEMINI_COMMERCE_IMAGE_MODEL ?? process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image";
    const model: GeminiImageModel = IMAGE_MODELS.has(configuredModel as GeminiImageModel)
      ? configuredModel as GeminiImageModel
      : "gemini-3.1-flash-image";
    const facts = productFacts(body.productDraft, body.identifier ?? undefined);

    const sourcePhotos = await Promise.all(captures.map(async (capture) => {
      const stored = await uploadGeneratedMediaObject({
        bytes: capture.bytes,
        mimeType: capture.mimeType,
        pathPrefix: `commerce/${spot.id}/product-sources`,
      });
      return {
        label: capture.label,
        detailIndex: capture.detailIndex,
        displayLabel: capture.displayLabel,
        url: stored.url,
        storagePath: stored.objectPath,
        mimeType: capture.mimeType,
      };
    }));

    const targets: GenerationTarget[] = [
      { kind: "front_catalog", sourceLabel: "Frente", detailIndex: null },
      ...(counts.back ? [{ kind: "back_catalog" as const, sourceLabel: "Atrás" as const, detailIndex: null }] : []),
    ];

    // Frente/Atrás definen la vista. Las demás fotos aportan evidencia para
    // quitar manos/oclusiones sin inventar packaging ni detalles del producto.
    const generatedImages = await Promise.all(targets.map((target) => {
      const targetCaptures = referencesForTarget(target, captures);
      const referenceOrder = targetCaptures.map((capture) => capture.displayLabel);
      const referenceImages: GeminiReferenceImage[] = targetCaptures.map((capture) => ({
        mimeType: capture.mimeType,
        data: capture.base64,
      }));
      return generateCatalogTarget({
        target,
        apiKey,
        model,
        facts,
        referenceOrder,
        referenceImages,
        spotId: spot.id,
      });
    }));

    const coverImage = generatedImages.find((image) => image.kind === "front_catalog")?.url
      ?? generatedImages[0]?.url
      ?? sourcePhotos.find((image) => image.label === "Frente")?.url
      ?? null;

    return NextResponse.json({
      provider: "gemini",
      model,
      sourcePhotos,
      generatedImages,
      coverImage,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const mapped = publicError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
