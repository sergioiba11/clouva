import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  buildSpotSku,
  validateCommerceIdentifier,
  type CommerceIdentifierType,
} from "@/lib/commerce/identifiers";
import {
  canonicalProductCaptureLabel,
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_PRODUCT_REFERENCE_IMAGES,
  MAX_PRODUCT_TOTAL_BYTES,
  orderProductCaptures,
  type ProductCaptureLabel,
} from "@/lib/commerce/product-capture-contract";
import { uploadGeneratedMediaObject } from "@/lib/gcs-media";
import {
  CommerceProductRecognitionError,
  recognizeCommerceProduct,
} from "@/lib/server/commerce-product-recognition";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const IDENTIFIER_TYPES = new Set<CommerceIdentifierType>([
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "clouva_barcode",
  "clouva_qr",
  "sku",
]);

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

type RecognitionImageInput = { dataUrl?: string; label?: unknown };
type ParsedSource = {
  label: ProductCaptureLabel;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  bytes: Buffer;
};
type StoredSource = {
  label: ProductCaptureLabel;
  detailIndex: number | null;
  displayLabel: string;
  url: string;
  storagePath: string;
  mimeType: string;
};

function isIdentifierType(value: unknown): value is CommerceIdentifierType {
  return typeof value === "string" && IDENTIFIER_TYPES.has(value as CommerceIdentifierType);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseSource(input: RecognitionImageInput, index: number): ParsedSource {
  const label = canonicalProductCaptureLabel(input.label);
  if (!label) throw new CommerceProductRecognitionError(`La vista ${index + 1} no tiene un label válido.`, 400);
  if (typeof input.dataUrl !== "string") throw new CommerceProductRecognitionError(`La vista ${label} no contiene una imagen.`, 400);
  const match = input.dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) throw new CommerceProductRecognitionError(`La vista ${label} no tiene un formato válido.`, 400);
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_MIME.has(mimeType)) throw new CommerceProductRecognitionError("Usá fotos JPG, PNG o WEBP.", 415);
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > MAX_PRODUCT_IMAGE_BYTES) {
    throw new CommerceProductRecognitionError(`La vista ${label} debe pesar hasta 5 MB.`, 413);
  }
  return { label, mimeType: mimeType as ParsedSource["mimeType"], bytes };
}

async function persistSources(args: {
  images: RecognitionImageInput[];
  spotId: string;
}): Promise<StoredSource[]> {
  if (args.images.length > MAX_PRODUCT_REFERENCE_IMAGES) {
    throw new CommerceProductRecognitionError(`Podés usar hasta ${MAX_PRODUCT_REFERENCE_IMAGES} referencias del producto.`, 400);
  }
  const parsed = orderProductCaptures(args.images.map(parseSource));
  const totalBytes = parsed.reduce((sum, image) => sum + image.bytes.length, 0);
  if (totalBytes > MAX_PRODUCT_TOTAL_BYTES) {
    throw new CommerceProductRecognitionError("Las fotos juntas superan el máximo de 24 MB.", 413);
  }
  let detailIndex = 0;
  return Promise.all(parsed.map(async (image) => {
    const indexed = image.label === "Detalle" ? ++detailIndex : null;
    const stored = await uploadGeneratedMediaObject({
      bytes: image.bytes,
      mimeType: image.mimeType,
      pathPrefix: `commerce/${args.spotId}/product-sources`,
    });
    return {
      label: image.label,
      detailIndex: indexed,
      displayLabel: indexed ? `Detalle ${indexed}` : image.label,
      url: stored.url,
      storagePath: stored.objectPath,
      mimeType: image.mimeType,
    };
  }));
}

function sourceMetadata(sources: StoredSource[]) {
  return sources.map((source) => ({
    label: source.label,
    display_label: source.displayLabel,
    detail_index: source.detailIndex,
    url: source.url,
    storage_path: source.storagePath,
    mime_type: source.mimeType,
  }));
}

function resultListingId(value: unknown) {
  const root = record(value);
  const listing = record(root.listing);
  return typeof listing.id === "string" ? listing.id : null;
}

function safeDraftKey(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/[^a-zA-Z0-9:_-]+/g, "").slice(0, 120)
    : "";
}

function draftMissing(args: {
  hasBack: boolean;
  externalIdentifier: boolean;
  name: string;
}) {
  return [
    ...(!args.hasBack ? ["back_photo"] : []),
    ...(!args.externalIdentifier ? ["external_identifier"] : []),
    ...(!args.name ? ["name"] : []),
    "price",
    "cost",
    "stock",
    "publication_master",
  ];
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      images?: RecognitionImageInput[];
      identifier?: string | null;
      identifierType?: unknown;
      draftListingId?: string | null;
      draftKey?: string | null;
    };

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const suppliedIdentifierRaw = body.identifier?.trim() && isIdentifierType(body.identifierType)
      ? { value: body.identifier.trim(), type: body.identifierType }
      : null;
    const suppliedValidation = suppliedIdentifierRaw
      ? validateCommerceIdentifier(suppliedIdentifierRaw.type, suppliedIdentifierRaw.value)
      : null;
    const suppliedIdentifier = suppliedIdentifierRaw && suppliedValidation?.valid
      ? { value: suppliedValidation.value, type: suppliedIdentifierRaw.type }
      : null;

    const images = body.images ?? [];
    const result = await recognizeCommerceProduct({
      images: images.map((image) => ({
        dataUrl: image.dataUrl ?? "",
        label: image.label,
      })),
      spotName: spot.name,
      suppliedIdentifier,
    });

    const storedSources = await persistSources({ images, spotId: spot.id });
    const recognized = result.recognition;
    const recognizedName = recognized.name || recognized.detectedObject || "Producto";
    const candidateIdentifier = suppliedIdentifier ?? recognized.identifier;
    const validatedCandidate = candidateIdentifier
      ? validateCommerceIdentifier(candidateIdentifier.type, candidateIdentifier.value)
      : null;
    const draftKey = safeDraftKey(body.draftKey) || randomUUID();
    const identifier = candidateIdentifier && validatedCandidate?.valid
      ? { value: validatedCandidate.value, type: candidateIdentifier.type }
      : {
          value: buildSpotSku({
            spotSlug: spot.slug,
            productName: recognizedName,
            color: recognized.color,
            size: recognized.size,
            suffix: draftKey.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || randomUUID().slice(0, 6),
          }),
          type: "sku" as const,
        };
    const externalIdentifier = !["sku", "clouva_barcode", "clouva_qr"].includes(identifier.type);
    const analyzedAt = new Date().toISOString();
    const recognitionMetadata = {
      source: "google_cloud_product_recognition",
      provider: result.provider,
      model: result.model,
      analyzed_at: analyzedAt,
      detected_object: recognized.detectedObject,
      name: recognizedName,
      description: recognized.description,
      brand: recognized.brand,
      category: recognized.category,
      product_kind: recognized.productKind,
      listing_kind: recognized.listingKind,
      size: recognized.size,
      color: recognized.color,
      presentation: recognized.presentation,
      confidence: recognized.confidence,
      visible_text: recognized.visibleText,
      uncertain_fields: recognized.uncertainFields,
      captured_views: storedSources.map((source) => source.displayLabel),
      identifier_type: identifier.type,
      identifier_value: identifier.value,
    };
    const lifecycle = {
      stage: "incomplete",
      source: "visual_scanner",
      draft_key: draftKey,
      required_to_create: ["front_photo", "identity"],
      required_to_publish: ["name", "price", "cover", "seller", "stock_if_physical", "publication_master"],
      optional_enrichment: ["back_photo", "external_identifier", "cost", "serial", "details"],
      missing: draftMissing({
        hasBack: storedSources.some((source) => source.label === "Atrás"),
        externalIdentifier,
        name: recognizedName,
      }),
      price_confirmed: false,
      cost_confirmed: false,
      stock_confirmed: false,
      external_identifier_pending: !externalIdentifier,
      last_saved_at: analyzedAt,
    };
    const productImagesMetadata = {
      provider: result.provider,
      model: result.model,
      source_photos: sourceMetadata(storedSources),
      generated_images: [],
      cover_image: storedSources.find((source) => source.label === "Frente")?.url ?? null,
    };
    const metadata = {
      recognition: recognitionMetadata,
      product_images: productImagesMetadata,
      draft_lifecycle: lifecycle,
      draft_fields: {
        brand: recognized.brand,
        category: recognized.category,
        product_kind: recognized.productKind,
        listing_kind: recognized.listingKind,
        size: recognized.size,
        color: recognized.color,
        presentation: recognized.presentation,
      },
    };

    const requestedDraftId = typeof body.draftListingId === "string" ? body.draftListingId.trim() : "";
    let draftResult: unknown;
    let listingId: string | null = null;

    if (requestedDraftId) {
      const { data: existing, error: existingError } = await admin
        .from("commerce_products")
        .select("id,catalog_product_id,metadata,cover_url,gallery,status")
        .eq("id", requestedDraftId)
        .eq("spot_id", spot.id)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);
      if (!existing) return NextResponse.json({ error: "Ese borrador ya no existe en este MI SPOT." }, { status: 404 });

      const existingMetadata = record(existing.metadata);
      const existingImages = record(existingMetadata.product_images);
      const nextMetadata = {
        ...existingMetadata,
        recognition: recognitionMetadata,
        draft_fields: metadata.draft_fields,
        draft_lifecycle: {
          ...record(existingMetadata.draft_lifecycle),
          ...lifecycle,
        },
        product_images: {
          ...existingImages,
          ...productImagesMetadata,
          generated_images: Array.isArray(existingImages.generated_images) ? existingImages.generated_images : [],
        },
      };
      const frontUrl = storedSources.find((source) => source.label === "Frente")?.url ?? null;
      const { data: updated, error: updateError } = await admin
        .from("commerce_products")
        .update({
          name: recognizedName,
          description: recognized.description || null,
          status: existing.status === "published" ? "published" : "draft",
          cover_url: existing.cover_url || frontUrl,
          gallery: Array.from(new Set([
            ...(existing.cover_url ? [existing.cover_url] : []),
            ...(Array.isArray(existing.gallery) ? existing.gallery.filter((url): url is string => typeof url === "string") : []),
            ...(frontUrl ? [frontUrl] : []),
          ])).slice(0, 24),
          metadata: nextMetadata,
          updated_at: analyzedAt,
        })
        .eq("id", existing.id)
        .eq("spot_id", spot.id)
        .select("id,catalog_product_id,status,cover_url,gallery,metadata")
        .single();
      if (updateError) throw new Error(updateError.message);
      listingId = updated.id;
      draftResult = { listing: updated, identifier, created: false };
    } else {
      const hasVariant = Boolean(recognized.size || recognized.color || recognized.presentation);
      const frontUrl = storedSources.find((source) => source.label === "Frente")?.url ?? "";
      const { data: created, error: createError } = await admin.rpc("upsert_commerce_scanned_product", {
        p_spot_id: spot.id,
        p_identifier_type: identifier.type,
        p_identifier_value: identifier.value,
        p_product: {
          product_kind: recognized.productKind,
          name: recognizedName,
          brand: recognized.brand,
          category: recognized.category,
          description: recognized.description,
          metadata,
        },
        p_listing: {
          listing_kind: recognized.listingKind,
          price: 0,
          cost: 0,
          initial_stock: 0,
          status: "draft",
          cover_url: frontUrl,
          gallery: frontUrl ? [frontUrl] : [],
          metadata,
        },
        p_variant: hasVariant ? {
          size: recognized.size,
          color: recognized.color,
          presentation: recognized.presentation,
          metadata: { recognition: recognitionMetadata },
        } : {},
        p_actor_id: user.id,
        p_idempotency_key: `commerce-draft:${spot.id}:${draftKey}`,
      });
      if (createError) throw new Error(createError.message);
      listingId = resultListingId(created);
      draftResult = created;
    }

    if (!listingId) throw new Error("CLOUVA no pudo resolver el borrador persistente del producto.");

    return NextResponse.json({
      recognition: result.recognition,
      provider: result.provider,
      model: result.model,
      analyzedAt,
      usage: result.usage,
      draft: {
        listingId,
        draftKey,
        status: "draft",
        stage: "incomplete",
        identifier,
        externalIdentifierPending: !externalIdentifier,
        sourcePhotos: storedSources,
        missing: lifecycle.missing,
        result: draftResult,
      },
    });
  } catch (error) {
    const status = error instanceof CommerceProductRecognitionError
      ? error.status
      : ((error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500));
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo reconocer el producto.",
    }, { status });
  }
}
