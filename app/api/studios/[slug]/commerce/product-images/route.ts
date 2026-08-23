import { NextRequest, NextResponse } from "next/server";
import {
  generateImage,
  GeminiImageError,
  type GeminiImageModel,
  type GeminiReferenceImage,
} from "@/lib/gemini-image";
import { uploadGeneratedMediaObject } from "@/lib/gcs-media";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

type CaptureLabel = "Frente" | "Atrás" | "Detalle";
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
type GeneratedKind = "front_catalog" | "back_catalog" | "detail_catalog";

const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_MODELS = new Set<GeminiImageModel>([
  "gemini-3.1-flash-lite-image",
  "gemini-3.1-flash-image",
  "gemini-3-pro-image",
]);

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

function captureLabel(value: unknown): CaptureLabel | null {
  if (value === "Frente" || value === "Atrás" || value === "Detalle") return value;
  // Compatibilidad con capturas creadas antes del cambio de nombre.
  if (value === "Dorso") return "Atrás";
  return null;
}

function parseCapture(input: ProductCaptureInput, index: number): ParsedCapture {
  const label = captureLabel(input.label);
  if (!label) throw new ProductImageError(`La vista ${index + 1} no tiene un label válido.`);
  if (typeof input.dataUrl !== "string") throw new ProductImageError(`La vista ${label} no contiene una imagen.`);
  const match = input.dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) throw new ProductImageError(`La vista ${label} no tiene un formato válido.`);
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_MIME.has(mimeType)) throw new ProductImageError("Usá fotos JPG, PNG o WEBP.", 415);
  const base64 = match[2].replace(/\s/g, "");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new ProductImageError(`La vista ${label} debe pesar hasta 5 MB.`, 413);
  }
  return { label, mimeType: mimeType as ParsedCapture["mimeType"], bytes, base64 };
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

function generationPrompt(kind: GeneratedKind, facts: string) {
  const target = kind === "front_catalog"
    ? "una vista frontal principal para catálogo"
    : kind === "back_catalog"
      ? "una vista trasera para catálogo"
      : "una vista de detalle complementaria para catálogo";
  return [
    "Sos el generador de imágenes de producto de CLOUVA.",
    `Creá ${target} del MISMO producto físico mostrado en las imágenes de referencia.`,
    facts,
    "Las referencias Frente, Atrás y Detalle pertenecen al mismo producto y deben usarse juntas para preservar su identidad.",
    "Conservá con máxima fidelidad la forma, proporciones, packaging, materiales visibles, colores, marca, logotipos, gráficos y textos que realmente se distingan en las referencias.",
    "No inventes texto, claims, accesorios, variantes, sellos, ingredientes, códigos, logos ni detalles que no estén sustentados por las referencias.",
    "No cambies el branding ni rediseñes el envase. No conviertas el producto en otro modelo o variante.",
    "Quitá únicamente el contexto fotográfico no comercial: manos, habitación, mesa desordenada, sombras accidentales y fondo de captura.",
    "Usá fondo de estudio limpio y neutro, iluminación e-commerce uniforme, producto completo y nítido, centrado, con escala natural.",
    kind === "front_catalog"
      ? "La orientación final debe corresponder a la cara frontal principal del producto."
      : kind === "back_catalog"
        ? "La orientación final debe corresponder a la cara posterior del producto y respetar la información visible de esa cara."
        : "La composición debe destacar el detalle realmente fotografiado sin alterar el producto.",
    "No agregues texto externo, marcos, mockups, decoraciones ni marcas de agua.",
  ].filter(Boolean).join("\n");
}

function publicError(error: unknown) {
  if (error instanceof ProductImageError) return { status: error.status, message: error.message };
  if (error instanceof GeminiImageError) {
    const message = error.message || "Gemini no pudo generar las imágenes del producto.";
    if (/quota|resource exhausted|rate limit/i.test(message)) return { status: 429, message: "La cuota de Gemini para imágenes está agotada." };
    if (/billing|paid tier|payment/i.test(message)) return { status: 402, message: "La generación de imágenes de Gemini requiere facturación habilitada." };
    if (/abort|timeout|timed out/i.test(message)) return { status: 504, message: "Gemini superó el tiempo de espera generando la imagen." };
    return { status: error.status || 502, message };
  }
  const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
  return { status, message: error instanceof Error ? error.message : "No se pudieron generar las imágenes del producto." };
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
    if (body.captures.length > MAX_IMAGES) throw new ProductImageError("Podés usar hasta tres vistas del producto.");

    const captures = body.captures.map(parseCapture);
    const labels = new Set<CaptureLabel>();
    for (const capture of captures) {
      if (labels.has(capture.label)) throw new ProductImageError(`La vista ${capture.label} está repetida.`);
      labels.add(capture.label);
    }
    if (!labels.has("Frente")) throw new ProductImageError("Capturá el Frente antes de generar imágenes de catálogo.");
    const totalBytes = captures.reduce((sum, capture) => sum + capture.bytes.length, 0);
    if (totalBytes > MAX_TOTAL_BYTES) throw new ProductImageError("Las fotos juntas superan el máximo de 12 MB.", 413);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new ProductImageError("GEMINI_API_KEY no está configurada.", 500);

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const configuredModel = process.env.GEMINI_COMMERCE_IMAGE_MODEL ?? process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image";
    const model: GeminiImageModel = IMAGE_MODELS.has(configuredModel as GeminiImageModel)
      ? configuredModel as GeminiImageModel
      : "gemini-3.1-flash-image";
    const facts = productFacts(body.productDraft, body.identifier ?? undefined);
    const referenceImages: GeminiReferenceImage[] = captures.map((capture) => ({
      mimeType: capture.mimeType,
      data: capture.base64,
    }));

    const sourcePhotos = await Promise.all(captures.map(async (capture) => {
      const stored = await uploadGeneratedMediaObject({
        bytes: capture.bytes,
        mimeType: capture.mimeType,
        pathPrefix: `commerce/${spot.id}/product-sources`,
      });
      return {
        label: capture.label,
        url: stored.url,
        storagePath: stored.objectPath,
        mimeType: capture.mimeType,
      };
    }));

    const targets: Array<{ kind: GeneratedKind; sourceLabel: CaptureLabel }> = [
      { kind: "front_catalog", sourceLabel: "Frente" },
      ...(labels.has("Atrás") ? [{ kind: "back_catalog" as const, sourceLabel: "Atrás" as const }] : []),
      ...(labels.has("Detalle") ? [{ kind: "detail_catalog" as const, sourceLabel: "Detalle" as const }] : []),
    ];

    const generatedImages = [] as Array<{
      kind: GeneratedKind;
      sourceLabel: CaptureLabel;
      url: string;
      storagePath: string;
      mimeType: string;
      model: GeminiImageModel;
    }>;

    // Se ejecutan en serie para mantener una sola línea de generación por Spot y
    // evitar ráfagas de cuota cuando se cargan Frente + Atrás + Detalle juntos.
    for (const target of targets) {
      const generated = await generateImage({
        apiKey,
        model,
        prompt: generationPrompt(target.kind, facts),
        referenceImages,
        aspectRatio: "1:1",
        imageSize: "1K",
        timeoutMs: 55_000,
      });
      const stored = await uploadGeneratedMediaObject({
        bytes: generated.bytes,
        mimeType: generated.mimeType,
        pathPrefix: `commerce/${spot.id}/product-generated`,
      });
      generatedImages.push({
        kind: target.kind,
        sourceLabel: target.sourceLabel,
        url: stored.url,
        storagePath: stored.objectPath,
        mimeType: generated.mimeType,
        model,
      });
    }

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
