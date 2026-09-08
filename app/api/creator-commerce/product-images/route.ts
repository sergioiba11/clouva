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
type Draft = {
  name?: unknown;
  brand?: unknown;
  category?: unknown;
  description?: unknown;
  color?: unknown;
  size?: unknown;
  productTemplate?: unknown;
  placement?: unknown;
  material?: unknown;
};
type ParsedCapture = {
  label: ProductCaptureLabel;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  bytes: Buffer;
  base64: string;
  detailIndex: number | null;
  displayLabel: string;
};
type GeneratedKind = "front_catalog" | "back_catalog" | "lifestyle_model" | "hero_product";
type StoredReference = { url?: unknown; label?: unknown; kind?: unknown };

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_MODELS = new Set<GeminiImageModel>(["gemini-3.1-flash-lite-image", "gemini-3.1-flash-image", "gemini-3-pro-image"]);
const GENERATION_TIMEOUT_MS = 150_000;
const BACK_VIEW_TEMPLATES = new Set(["shirt", "hoodie", "sweatshirt", "jacket", "tote_bag", "backpack", "custom"]);
const IDENTITY_REFERENCE_LIMIT = 6;
const IDENTITY_REFERENCE_MAX_BYTES = 8 * 1024 * 1024;
const GENERATED_BUCKET = process.env.CLOUVA_GENERATED_MEDIA_BUCKET ?? "clouva-generated-media";

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

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function compactJson(value: unknown, max = 1800) {
  const text = JSON.stringify(asRecord(value));
  return text === "{}" ? "" : text.slice(0, max);
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
    ["template", short(draft?.productTemplate, 80)],
    ["color", short(draft?.color, 80)],
    ["talle", short(draft?.size, 80)],
    ["placement", short(draft?.placement, 220)],
    ["material", short(draft?.material, 160)],
  ].filter(([, value]) => value);
  const description = short(draft?.description, 1400);
  return [rows.length ? `Ficha: ${rows.map(([key, value]) => `${key}: ${value}`).join("; ")}.` : "", description ? `Brief: ${description}.` : ""].filter(Boolean).join("\n");
}

function sharedIdentity(projectName: string, collectionName: string, designSystem: string, overrides: string) {
  return [
    `DROP: ${projectName}${collectionName ? ` · ${collectionName}` : ""}.`,
    designSystem ? `DESIGN SYSTEM DEL DROP (heredado): ${designSystem}` : "",
    overrides ? `OVERRIDES DE ESTE PRODUCTO: ${overrides}` : "",
    "Este producto pertenece a una colección. Mantené coherencia de paleta, símbolos, lenguaje gráfico, materiales y mood con el mismo drop; no inventes otra identidad visual.",
  ].filter(Boolean).join("\n");
}

function modeInstruction(mode: string) {
  if (mode === "exact_design") return "MODO DISEÑO EXACTO: preservá estrictamente el artwork master, logos, ilustraciones, texto, colores y geometría. Podés adaptar escala/posición al soporte, pero NO reinterpretar el diseño.";
  if (mode === "reference") return "MODO REFERENCIA: usá las referencias como guía estética y estructural, sin copiar elementos ajenos que no pertenezcan al proyecto.";
  return "MODO DESDE CERO: diseñá el producto desde el brief y el Design System. No agregues marcas, logos o texto que el usuario no haya pedido.";
}

function catalogPrompt(kind: "front_catalog" | "back_catalog", mode: string, draftFacts: string, refs: string[], identity: string) {
  const side = kind === "front_catalog" ? "Frente" : "Atrás";
  return [
    "Sos el generador de producto de CLOUVA Commerce Creator.",
    `Salida requerida: ${side} de catálogo, producto solo, fondo blanco o neutro, composición profesional 1:1.`,
    identity,
    draftFacts,
    refs.length ? `Referencias visuales cargadas: ${refs.join(", ")}.` : "",
    modeInstruction(mode),
    "Separá ARTWORK MASTER de MOCKUP: no deformes el arte para hacerlo más llamativo.",
    "No muestres personas, manos, props ni objetos ajenos al producto.",
    kind === "front_catalog" ? "Mantené una vista frontal clara." : "Mantené una vista trasera clara y no mezcles el frente.",
  ].filter(Boolean).join("\n");
}

function lifestylePrompt(mode: string, draftFacts: string, identity: string, hasReferences: boolean, campaignStyle: string) {
  return [
    "Sos el generador de campaña de CLOUVA Commerce Creator.",
    `Generá una imagen vertical 4:5 de lifestyle con una persona ADULTA completamente ficticia usando o presentando el producto ${hasReferences ? "de las referencias" : "descripto en el brief"}.`,
    identity,
    draftFacts,
    campaignStyle ? `Estilo de campaña: ${campaignStyle}.` : "Estilo de campaña: premium urbano futurista.",
    hasReferences ? "Conservá el diseño, colores, logos, textos y materiales visibles del producto." : "El producto debe coincidir con la dirección de catálogo del mismo brief.",
    modeInstruction(mode),
    "No imites celebridades ni personas reales identificables. No agregues marcas externas ni texto promocional flotando sobre la imagen.",
  ].filter(Boolean).join("\n");
}

function heroPrompt(mode: string, draftFacts: string, identity: string) {
  return [
    "Sos el director de arte de CLOUVA Commerce Creator.",
    "Generá un hero comercial 1:1 del producto, cinematográfico pero usable en ecommerce. Producto protagonista, fondo coherente con el drop, sin texto agregado.",
    identity,
    draftFacts,
    modeInstruction(mode),
    "No reemplaces ni deformes el artwork aprobado.",
  ].filter(Boolean).join("\n");
}

function trustedIdentityUrl(value: unknown) {
  const raw = short(value, 2000);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" || parsed.hostname !== "storage.googleapis.com") return null;
    if (!parsed.pathname.startsWith(`/${GENERATED_BUCKET}/creator-commerce/`)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

async function loadStoredReferences(value: unknown) {
  if (!Array.isArray(value)) return { references: [] as GeminiReferenceImage[], names: [] as string[] };
  const assets = value.slice(0, IDENTITY_REFERENCE_LIMIT) as StoredReference[];
  const references: GeminiReferenceImage[] = [];
  const names: string[] = [];
  for (const asset of assets) {
    const url = trustedIdentityUrl(asset?.url);
    if (!url) continue;
    try {
      const response = await fetch(url, { cache: "force-cache", signal: AbortSignal.timeout(20_000) });
      if (!response.ok) continue;
      const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() || "";
      if (!ALLOWED_MIME.has(mimeType)) continue;
      const declared = Number(response.headers.get("content-length") || "0");
      if (declared > IDENTITY_REFERENCE_MAX_BYTES) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > IDENTITY_REFERENCE_MAX_BYTES) continue;
      references.push({ mimeType, data: bytes.toString("base64") });
      names.push(short(asset.label, 100) || short(asset.kind, 60) || "Identidad del drop");
    } catch {
      // A missing project reference should not kill the whole product generation.
    }
  }
  return { references, names };
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
    const { user, supabase } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      projectId?: unknown;
      conceptId?: unknown;
      creativeMode?: unknown;
      captures?: CaptureInput[];
      productDraft?: Draft;
      includeLifestyle?: unknown;
      includeHero?: unknown;
      campaignStyle?: unknown;
    };
    const mode = ["from_scratch", "exact_design", "reference"].includes(String(body.creativeMode)) ? String(body.creativeMode) : "from_scratch";
    const projectId = short(body.projectId, 80);
    const conceptId = short(body.conceptId, 80);

    let projectName = "CLOUVA Drop";
    let collectionName = "";
    let storedDesignSystem: unknown = {};
    let storedOverrides: unknown = {};
    let storedTemplate = short(body.productDraft?.productTemplate, 80) || "custom";
    let storedProjectReferences: unknown = [];
    if (projectId) {
      const project = await supabase
        .from("commerce_creator_projects")
        .select("id,name,collection_name,design_system,reference_assets")
        .eq("id", projectId)
        .maybeSingle();
      if (project.error) throw new CreatorImageError(project.error.message, 500);
      if (!project.data) throw new CreatorImageError("El proyecto no existe o no tenés permiso.", 404);
      projectName = project.data.name;
      collectionName = project.data.collection_name || "";
      storedDesignSystem = project.data.design_system;
      storedProjectReferences = project.data.reference_assets;

      if (conceptId) {
        const concept = await supabase
          .from("commerce_creator_product_concepts")
          .select("id,product_template,design_overrides")
          .eq("id", conceptId)
          .eq("project_id", projectId)
          .maybeSingle();
        if (concept.error) throw new CreatorImageError(concept.error.message, 500);
        if (!concept.data) throw new CreatorImageError("El producto creativo no existe o no tenés permiso.", 404);
        storedOverrides = concept.data.design_overrides;
        storedTemplate = concept.data.product_template || storedTemplate;
      }
    }

    const captureInputs = Array.isArray(body.captures) ? body.captures : [];
    if (captureInputs.length > MAX_PRODUCT_REFERENCE_IMAGES) throw new CreatorImageError(`Podés usar hasta ${MAX_PRODUCT_REFERENCE_IMAGES} referencias.`);
    const parsed = indexed(captureInputs.map(parseCapture));
    const counts = countProductCaptureLabels(parsed.map((capture) => capture.label));
    if (counts.front > 1) throw new CreatorImageError("Podés usar como máximo una vista Frente.");
    if (counts.back > 1) throw new CreatorImageError("Podés usar como máximo una vista Atrás.");
    if (counts.detail > MAX_PRODUCT_DETAIL_IMAGES) throw new CreatorImageError(`Podés usar hasta ${MAX_PRODUCT_DETAIL_IMAGES} Detalles.`);
    if (parsed.reduce((sum, capture) => sum + capture.bytes.length, 0) > MAX_PRODUCT_TOTAL_BYTES) throw new CreatorImageError("Las referencias superan el máximo total de 24 MB.", 413);

    const storedRefs = await loadStoredReferences(storedProjectReferences);
    if (mode !== "from_scratch" && counts.front !== 1 && storedRefs.references.length < 1) {
      throw new CreatorImageError("Diseño exacto y Referencia requieren una vista Frente o un asset de identidad guardado en el drop.");
    }

    const draftFacts = facts({ ...body.productDraft, productTemplate: storedTemplate });
    if (mode === "from_scratch" && !draftFacts) throw new CreatorImageError("Describí el producto que querés crear.");

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new CreatorImageError("GEMINI_API_KEY no está configurada.", 500);
    const configuredModel = process.env.GEMINI_COMMERCE_IMAGE_MODEL ?? process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image";
    const model: GeminiImageModel = IMAGE_MODELS.has(configuredModel as GeminiImageModel) ? configuredModel as GeminiImageModel : "gemini-3.1-flash-image";
    const prefix = `creator-commerce/${user.id}/${projectId || "draft"}/${conceptId || "project"}`;
    const identity = sharedIdentity(projectName, collectionName, compactJson(storedDesignSystem), compactJson(storedOverrides));

    const sourcePhotos = await Promise.all(parsed.map(async (capture) => {
      const stored = await uploadGeneratedMediaObject({ bytes: capture.bytes, mimeType: capture.mimeType, pathPrefix: `${prefix}/sources` });
      return { label: capture.label, detailIndex: capture.detailIndex, displayLabel: capture.displayLabel, url: stored.url, storagePath: stored.objectPath, mimeType: capture.mimeType };
    }));

    const localReferences: GeminiReferenceImage[] = parsed.map((capture) => ({ mimeType: capture.mimeType, data: capture.base64 }));
    const references = [...storedRefs.references, ...localReferences].slice(0, MAX_PRODUCT_REFERENCE_IMAGES);
    const refNames = [...storedRefs.names, ...parsed.map((capture) => capture.displayLabel)].slice(0, MAX_PRODUCT_REFERENCE_IMAGES);
    const needsBack = counts.back > 0 || (mode === "from_scratch" && BACK_VIEW_TEMPLATES.has(storedTemplate));
    const campaignStyle = short(body.campaignStyle, 80);
    const targets: Array<{ kind: GeneratedKind; prompt: string; aspectRatio: "1:1" | "4:5" }> = [
      { kind: "front_catalog", prompt: catalogPrompt("front_catalog", mode, draftFacts, refNames, identity), aspectRatio: "1:1" },
      ...(needsBack ? [{ kind: "back_catalog" as const, prompt: catalogPrompt("back_catalog", mode, draftFacts, refNames, identity), aspectRatio: "1:1" as const }] : []),
      ...(body.includeLifestyle === true ? [{ kind: "lifestyle_model" as const, prompt: lifestylePrompt(mode, draftFacts, identity, references.length > 0, campaignStyle), aspectRatio: "4:5" as const }] : []),
      ...(body.includeHero === true ? [{ kind: "hero_product" as const, prompt: heroPrompt(mode, draftFacts, identity), aspectRatio: "1:1" as const }] : []),
    ];

    const generatedImages: Array<{ kind: GeneratedKind; url: string; storagePath: string; mimeType: string; model: GeminiImageModel }> = [];
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
