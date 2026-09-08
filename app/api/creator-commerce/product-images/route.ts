import { NextRequest, NextResponse } from "next/server";
import { generateImage, GeminiImageError, type GeminiImageModel, type GeminiReferenceImage } from "@/lib/gemini-image";
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
import { isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type CaptureInput = { label?: unknown; dataUrl?: unknown };
type Draft = { name?: unknown; brand?: unknown; category?: unknown; description?: unknown; color?: unknown; size?: unknown };
type ParsedCapture = {
  label: ProductCaptureLabel;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  bytes: Buffer;
  base64: string;
  detailIndex: number | null;
  displayLabel: string;
};
type GeneratedKind = "front_catalog" | "back_catalog" | "lifestyle_model";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_MODELS = new Set<GeminiImageModel>(["gemini-3.1-flash-lite-image", "gemini-3.1-flash-image", "gemini-3-pro-image"]);
const GENERATION_TIMEOUT_MS = 150_000;

class CreatorImageError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function short(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseCapture(input: CaptureInput, index: number) {
  const label = canonicalProductCaptureLabel(input.label);
  if (!label) throw new CreatorImageError(`La vista ${index + 1} no tiene un label válido.`);
  if (typeof input.dataUrl !== "string") throw new CreatorImageError(`La vista ${label} no contiene una imagen.`);
  const match = input.dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) throw new CreatorImageError(`La vista ${label} no tiene un formato válido.`);
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_MIME.has(mimeType)) throw new CreatorImageError("Usá JPG, PNG o WEBP.", 415);
  const base64 = match[2].replace(/\s/g, "");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > MAX_PRODUCT_IMAGE_BYTES) throw new CreatorImageError(`La vista ${label} debe pesar hasta 5 MB.`, 413);
  return { label, mimeType: mimeType as ParsedCapture["mimeType"], bytes, base64 };
}

function indexed(inputs: ReturnType<typeof parseCapture>[]): ParsedCapture[] {
  let detail = 0;
  return orderProductCaptures(inputs).map((capture) => ({
    ...capture,
    detailIndex: capture.label === "Detalle" ? ++detail : null,
    displayLabel: capture.label === "Detalle" ? `Detalle ${detail}` : capture.label,
  }));
}

function facts(draft: Draft | undefined) {
  const rows = [
    ["nombre", short(draft?.name, 180)],
    ["marca", short(draft?.brand, 120)],
    ["categoría", short(draft?.category, 120)],
    ["color", short(draft?.color, 80)],
    ["talle", short(draft?.size, 80)],
  ].filter(([, value]) => value);
  const description = short(draft?.description, 1000);
  return [rows.length ? `Ficha: ${rows.map(([key, value]) => `${key}: ${value}`).join("; ")}.` : "", description ? `Brief: ${description}.` : ""].filter(Boolean).join("\n");
}

function catalogPrompt(kind: "front_catalog" | "back_catalog", mode: string, draftFacts: string, refs: string[]) {
  const side = kind === "front_catalog" ? "Frente" : "Atrás";
  return [
    "Sos el generador de imágenes de producto de CLOUVA Commerce Creator.",
    `Salida requerida: ${side} de catálogo, producto solo, fondo blanco o neutro, composición profesional 1:1.`,
    draftFacts,
    refs.length ? `Referencias disponibles: ${refs.join(", ")}.` : "",
    mode === "exact_design"
      ? "MODO DISEÑO EXACTO: preservá estrictamente logos, ilustraciones, texto, colores, geometría, materiales y ubicación del diseño. No reinterpretés ni inventes contenido."
      : mode === "reference"
        ? "MODO REFERENCIA: mantené el producto y la identidad definida por el brief, usando las referencias como guía estética sin copiar elementos ajenos que no pertenezcan al proyecto."
        : "MODO DESDE CERO: respetá el brief y la identidad del producto sin agregar marcas o texto no solicitado.",
    "No muestres personas, manos, props ni objetos ajenos al producto.",
    kind === "front_catalog" ? "Mantené una vista frontal clara." : "Mantené una vista trasera clara y no mezcles el frente.",
  ].filter(Boolean).join("\n");
}

function lifestylePrompt(mode: string, draftFacts: string) {
  return [
    "Sos el generador de campaña de CLOUVA Commerce Creator.",
    "Generá una imagen vertical 4:5 de lifestyle con una persona ADULTA completamente ficticia usando o presentando el producto de las referencias.",
    draftFacts,
    "El producto debe seguir siendo el protagonista y conservar su diseño, colores, logos, textos y materiales visibles.",
    mode === "exact_design" ? "No alteres el arte ni su ubicación. Fidelidad máxima al diseño entregado." : "Mantené coherencia con el universo visual del brief.",
    "No imites a una celebridad ni a una persona real identificable. No agregues marcas externas ni texto promocional sobre la imagen.",
  ].filter(Boolean).join("\n");
}

function publicError(error: unknown) {
  if (error instanceof CreatorImageError) return { status: error.status, message: error.message };
  if (error instanceof GeminiImageError) {
    const message = error.message || "Gemini no pudo generar la imagen.";
    if (/quota|resource exhausted|rate limit/i.test(message)) return { status: 429, message: "La cuota de Gemini para imágenes está agotada." };
    if (/billing|paid tier|payment/i.test(message)) return { status: 402, message: "La generación de imágenes requiere facturación habilitada." };
    if (/abort|timeout|timed out/i.test(message)) return { status: 504, message: "Gemini superó el tiempo de espera." };
    return { status: error.status || 502, message };
  }
  const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
  return { status, message: error instanceof Error ? error.message : "No se pudieron generar las imágenes." };
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      projectId?: unknown;
      creativeMode?: unknown;
      captures?: CaptureInput[];
      productDraft?: Draft;
      includeLifestyle?: unknown;
    };
    if (!Array.isArray(body.captures) || body.captures.length < 1) throw new CreatorImageError("Subí al menos una vista Frente.");
    if (body.captures.length > MAX_PRODUCT_REFERENCE_IMAGES) throw new CreatorImageError(`Podés usar hasta ${MAX_PRODUCT_REFERENCE_IMAGES} referencias.`);

    const parsed = indexed(body.captures.map(parseCapture));
    const counts = countProductCaptureLabels(parsed.map((capture) => capture.label));
    if (counts.front !== 1) throw new CreatorImageError("Necesitás exactamente un Frente.");
    if (counts.back > 1) throw new CreatorImageError("Podés usar como máximo una vista Atrás.");
    if (counts.detail > MAX_PRODUCT_DETAIL_IMAGES) throw new CreatorImageError(`Podés usar hasta ${MAX_PRODUCT_DETAIL_IMAGES} Detalles.`);
    if (parsed.reduce((sum, capture) => sum + capture.bytes.length, 0) > MAX_PRODUCT_TOTAL_BYTES) throw new CreatorImageError("Las referencias superan el máximo total de 24 MB.", 413);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new CreatorImageError("GEMINI_API_KEY no está configurada.", 500);
    const configuredModel = process.env.GEMINI_COMMERCE_IMAGE_MODEL ?? process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image";
    const model: GeminiImageModel = IMAGE_MODELS.has(configuredModel as GeminiImageModel) ? configuredModel as GeminiImageModel : "gemini-3.1-flash-image";
    const projectId = short(body.projectId, 80) || "draft";
    const mode = ["from_scratch", "exact_design", "reference"].includes(String(body.creativeMode)) ? String(body.creativeMode) : "from_scratch";
    const draftFacts = facts(body.productDraft);
    const prefix = `creator-commerce/${user.id}/${projectId}`;

    const sourcePhotos = await Promise.all(parsed.map(async (capture) => {
      const stored = await uploadGeneratedMediaObject({ bytes: capture.bytes, mimeType: capture.mimeType, pathPrefix: `${prefix}/sources` });
      return { label: capture.label, detailIndex: capture.detailIndex, displayLabel: capture.displayLabel, url: stored.url, storagePath: stored.objectPath, mimeType: capture.mimeType };
    }));

    const references: GeminiReferenceImage[] = parsed.map((capture) => ({ mimeType: capture.mimeType, data: capture.base64 }));
    const refNames = parsed.map((capture) => capture.displayLabel);
    const targets: Array<{ kind: GeneratedKind; prompt: string; aspectRatio: "1:1" | "4:5" }> = [
      { kind: "front_catalog", prompt: catalogPrompt("front_catalog", mode, draftFacts, refNames), aspectRatio: "1:1" },
      ...(counts.back ? [{ kind: "back_catalog" as const, prompt: catalogPrompt("back_catalog", mode, draftFacts, refNames), aspectRatio: "1:1" as const }] : []),
      ...(body.includeLifestyle === true ? [{ kind: "lifestyle_model" as const, prompt: lifestylePrompt(mode, draftFacts), aspectRatio: "4:5" as const }] : []),
    ];

    const generatedImages = [] as Array<{ kind: GeneratedKind; url: string; storagePath: string; mimeType: string; model: GeminiImageModel }>;
    for (const target of targets) {
      const generated = await generateImage({ apiKey, model, prompt: target.prompt, referenceImages: references, aspectRatio: target.aspectRatio, imageSize: "1K", timeoutMs: GENERATION_TIMEOUT_MS });
      const stored = await uploadGeneratedMediaObject({ bytes: generated.bytes, mimeType: generated.mimeType, pathPrefix: `${prefix}/generated` });
      generatedImages.push({ kind: target.kind, url: stored.url, storagePath: stored.objectPath, mimeType: generated.mimeType, model });
    }

    const coverImage = generatedImages.find((image) => image.kind === "front_catalog")?.url ?? sourcePhotos.find((image) => image.label === "Frente")?.url ?? null;
    return NextResponse.json({ provider: "gemini", model, sourcePhotos, generatedImages, coverImage, generatedAt: new Date().toISOString() });
  } catch (error) {
    const mapped = publicError(error);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
