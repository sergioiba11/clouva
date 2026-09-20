import { NextRequest, NextResponse } from "next/server";
import { buildSpotSku, validateCommerceIdentifier, type CommerceIdentifierType } from "@/lib/commerce/identifiers";
import type { CommerceProductRecognition } from "@/lib/commerce/product-recognition";
import { downloadGeneratedMediaObject } from "@/lib/gcs-media";
import type { CommerceBatchGroup } from "@/lib/server/commerce-product-batch-recognition";
import { recognizeCommerceProduct } from "@/lib/server/commerce-product-recognition";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GROUPS_PER_CALL = 3;
const MAX_RECOGNITION_IMAGES = 14;

type JsonRecord = Record<string, unknown>;
type BatchItem = {
  id: string;
  source_index: number;
  source_url: string;
  storage_path: string;
  mime_type: string;
  status: string;
  group_key: string | null;
  listing_id: string | null;
  recognition: JsonRecord | null;
  error: string | null;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function resultListingId(value: unknown) {
  const root = record(value);
  const listing = record(root.listing);
  return typeof listing.id === "string" ? listing.id : null;
}

function safeIdentifier(value: unknown) {
  const raw = record(value);
  const identifierValue = typeof raw.value === "string" ? raw.value.trim() : "";
  const identifierType = typeof raw.type === "string" ? raw.type as CommerceIdentifierType : null;
  if (!identifierValue || !identifierType) return null;
  const supported = new Set<CommerceIdentifierType>([
    "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "clouva_barcode", "clouva_qr", "sku",
  ]);
  if (!supported.has(identifierType)) return null;
  const validation = validateCommerceIdentifier(identifierType, identifierValue);
  return validation.valid ? { value: validation.value, type: identifierType } : null;
}

function recognizedIdentifier(recognition: CommerceProductRecognition) {
  if (!recognition.identifier?.value || !recognition.identifier.type) return null;
  const validation = validateCommerceIdentifier(recognition.identifier.type, recognition.identifier.value);
  return validation.valid
    ? { value: validation.value, type: recognition.identifier.type }
    : null;
}

function sourceMetadata(args: {
  group: CommerceBatchGroup;
  itemsByIndex: Map<number, BatchItem>;
}) {
  let detailIndex = 0;
  return args.group.images.flatMap((image) => {
    const item = args.itemsByIndex.get(image.sourceIndex);
    if (!item) return [];
    const detail = image.role === "Detalle" ? ++detailIndex : null;
    return [{
      label: image.role,
      display_label: detail ? `Detalle ${detail}` : image.role,
      detail_index: detail,
      url: item.source_url,
      storage_path: item.storage_path,
      mime_type: item.mime_type,
    }];
  });
}

function missingFields(args: { hasBack: boolean; externalIdentifier: boolean; name: string }) {
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

function groupsFromMetadata(metadata: unknown): CommerceBatchGroup[] {
  const root = record(metadata);
  if (!Array.isArray(root.groups)) return [];
  return root.groups.flatMap((raw) => {
    const group = record(raw);
    const images = Array.isArray(group.images) ? group.images.flatMap((value) => {
      const image = record(value);
      const sourceIndex = Number(image.sourceIndex);
      if (!Number.isInteger(sourceIndex)) return [];
      const role: CommerceBatchGroup["images"][number]["role"] = image.role === "Atrás" ? "Atrás" : image.role === "Detalle" ? "Detalle" : "Frente";
      return [{ sourceIndex, role }];
    }) : [];
    const groupKey = typeof group.groupKey === "string" ? group.groupKey : "";
    if (!groupKey || !images.length) return [];
    const visibleIdentifiers = Array.isArray(group.visibleIdentifiers)
      ? group.visibleIdentifiers.flatMap((value) => {
          const rawIdentifier = record(value);
          const identifier = safeIdentifier(rawIdentifier);
          if (!identifier) return [];
          const source: CommerceBatchGroup["visibleIdentifiers"][number]["source"] = rawIdentifier.source === "box" ? "box" : rawIdentifier.source === "product" ? "product" : "unknown";
          return [{
            ...identifier,
            source,
            confidence: Math.max(0, Math.min(1, Number(rawIdentifier.confidence || 0))),
          }];
        })
      : [];
    const packageKind = group.packageKind === "box"
      ? "box"
      : group.packageKind === "retail_package"
        ? "retail_package"
        : group.packageKind === "loose_product"
          ? "loose_product"
          : "unknown";
    return [{
      groupKey,
      name: typeof group.name === "string" ? group.name : "",
      brand: typeof group.brand === "string" ? group.brand : "",
      model: typeof group.model === "string" ? group.model : "",
      packageKind,
      identifier: safeIdentifier(group.identifier),
      visibleIdentifiers,
      confidence: Number(group.confidence || 0),
      needsReview: group.needsReview === true,
      images,
    } satisfies CommerceBatchGroup];
  });
}

async function recognizeGroup(args: {
  group: CommerceBatchGroup;
  itemsByIndex: Map<number, BatchItem>;
  spotName: string;
}) {
  const ordered = args.group.images
    .map((image) => ({ image, item: args.itemsByIndex.get(image.sourceIndex) }))
    .filter((entry): entry is { image: CommerceBatchGroup["images"][number]; item: BatchItem } => Boolean(entry.item));

  const front = ordered.filter((entry) => entry.image.role === "Frente").slice(0, 1);
  const back = ordered.filter((entry) => entry.image.role === "Atrás").slice(0, 1);
  const details = ordered.filter((entry) => entry.image.role === "Detalle");
  const references = [...front, ...back, ...details].slice(0, MAX_RECOGNITION_IMAGES);

  const images = await Promise.all(references.map(async ({ image, item }) => {
    const stored = await downloadGeneratedMediaObject(item.storage_path);
    const mimeType = stored.mimeType.startsWith("image/") ? stored.mimeType : item.mime_type;
    return {
      label: image.role,
      dataUrl: `data:${mimeType};base64,${stored.bytes.toString("base64")}`,
    };
  }));

  const suppliedIdentifier = args.group.identifier && args.group.identifier.type !== "sku"
    ? args.group.identifier
    : null;
  return recognizeCommerceProduct({
    images,
    spotName: args.spotName,
    suppliedIdentifier,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; batchId: string }> },
) {
  try {
    const { user } = await requireUser(request);
    const { slug, batchId } = await params;
    const body = (await request.json().catch(() => ({}))) as { retryFailed?: boolean };
    const retryFailed = body.retryFailed === true;

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId: slug });

    const { data: batch, error: batchError } = await admin
      .from("commerce_product_import_batches")
      .select("id,status,metadata")
      .eq("id", batchId)
      .eq("spot_id", spot.id)
      .maybeSingle();
    if (batchError) throw new Error(batchError.message);
    if (!batch) return NextResponse.json({ error: "El lote no existe en este Spot." }, { status: 404 });

    const groups = groupsFromMetadata(batch.metadata);
    if (!groups.length) return NextResponse.json({ error: "Primero analizá y agrupá las imágenes del lote." }, { status: 409 });

    const { data: itemRows, error: itemsError } = await admin
      .from("commerce_product_import_items")
      .select("id,source_index,source_url,storage_path,mime_type,status,group_key,listing_id,recognition,error")
      .eq("batch_id", batch.id)
      .eq("spot_id", spot.id)
      .order("source_index");
    if (itemsError) throw new Error(itemsError.message);
    const items = (itemRows ?? []) as BatchItem[];
    const itemsByIndex = new Map(items.map((item) => [item.source_index, item]));

    const pendingGroups = groups.filter((group) => {
      const groupItems = group.images.flatMap((image) => {
        const item = itemsByIndex.get(image.sourceIndex);
        return item ? [item] : [];
      });
      if (groupItems.some((item) => Boolean(item.listing_id))) return false;
      return groupItems.some((item) => item.status === "grouped" || (retryFailed && item.status === "error"));
    });

    const selectedGroups = pendingGroups.slice(0, GROUPS_PER_CALL);
    if (!selectedGroups.length) {
      const groupStates = groups.map((group) => {
        const groupItems = group.images.flatMap((image) => {
          const item = itemsByIndex.get(image.sourceIndex);
          return item ? [item] : [];
        });
        return {
          created: groupItems.some((item) => Boolean(item.listing_id)),
          failed: groupItems.length > 0 && groupItems.every((item) => item.status === "error"),
        };
      });
      const processed = groupStates.filter((state) => state.created).length;
      const failed = groupStates.filter((state) => state.failed).length;
      const remaining = groups.length - processed - failed;
      const status = remaining > 0 ? "processing" : failed > 0 ? "completed_with_errors" : "completed";
      await admin
        .from("commerce_product_import_batches")
        .update({
          status,
          processed_products: processed,
          failed_products: failed,
          updated_at: new Date().toISOString(),
        })
        .eq("id", batch.id);
      return NextResponse.json({ batchId: batch.id, status, processed, failed, remaining, results: [] });
    }

    await admin
      .from("commerce_product_import_batches")
      .update({ status: "processing", error: null, updated_at: new Date().toISOString() })
      .eq("id", batch.id);

    const results: Array<Record<string, unknown>> = [];

    for (const group of selectedGroups) {
      const groupItems = group.images.flatMap((image) => {
        const item = itemsByIndex.get(image.sourceIndex);
        return item ? [item] : [];
      });
      const itemIds = groupItems.map((item) => item.id);
      if (!itemIds.length) continue;

      await admin
        .from("commerce_product_import_items")
        .update({ status: "processing", error: null, updated_at: new Date().toISOString() })
        .in("id", itemIds);

      try {
        const recognizedResult = await recognizeGroup({ group, itemsByIndex, spotName: spot.name });
        const recognized = recognizedResult.recognition;
        const recognizedName = recognized.name || group.name || recognized.detectedObject || "Producto";
        const externalIdentifier = recognizedIdentifier(recognized) ?? safeIdentifier(group.identifier);
        const identifier = externalIdentifier ?? {
          value: buildSpotSku({
            spotSlug: spot.slug,
            productName: recognizedName,
            color: recognized.color,
            size: recognized.size,
            suffix: `${batch.id.slice(0, 3)}${group.groupKey.replace(/[^a-zA-Z0-9]/g, "").slice(-3)}`,
          }),
          type: "sku" as const,
        };
        const analyzedAt = new Date().toISOString();
        const sources = sourceMetadata({ group, itemsByIndex });
        const frontUrl = sources.find((source) => source.label === "Frente")?.url ?? sources[0]?.url ?? "";
        const hasBack = sources.some((source) => source.label === "Atrás");
        const hasVariant = Boolean(recognized.size || recognized.color || recognized.presentation);
        const recognitionMetadata = {
          source: "google_cloud_product_batch_import",
          provider: recognizedResult.provider,
          model: recognizedResult.model,
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
          captured_views: sources.map((source) => source.display_label),
          package_kind: group.packageKind,
          visible_identifiers: group.visibleIdentifiers,
          identifier_type: identifier.type,
          identifier_value: identifier.value,
        };
        const metadata = {
          recognition: recognitionMetadata,
          product_images: {
            provider: recognizedResult.provider,
            model: recognizedResult.model,
            source_photos: sources,
            generated_images: [],
            cover_image: frontUrl || null,
          },
          draft_lifecycle: {
            stage: "incomplete",
            source: "visual_batch_import",
            batch_id: batch.id,
            group_key: group.groupKey,
            required_to_create: ["front_photo", "identity"],
            required_to_publish: ["name", "price", "cover", "seller", "stock_if_physical", "publication_master"],
            optional_enrichment: ["back_photo", "external_identifier", "cost", "serial", "details"],
            missing: missingFields({
              hasBack,
              externalIdentifier: Boolean(externalIdentifier),
              name: recognizedName,
            }),
            price_confirmed: false,
            cost_confirmed: false,
            stock_confirmed: false,
            external_identifier_pending: !externalIdentifier,
            last_saved_at: analyzedAt,
          },
          draft_fields: {
            brand: recognized.brand,
            category: recognized.category,
            product_kind: recognized.productKind,
            listing_kind: recognized.listingKind,
            size: recognized.size,
            color: recognized.color,
            presentation: recognized.presentation,
          },
          batch_import: {
            batch_id: batch.id,
            group_key: group.groupKey,
            package_kind: group.packageKind,
            visible_identifiers: group.visibleIdentifiers,
            confidence: group.confidence,
            needs_review: group.needsReview,
            source_indexes: group.images.map((image) => image.sourceIndex),
          },
        };

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
          p_idempotency_key: `commerce-batch:${batch.id}:${group.groupKey}`,
        });
        if (createError) throw new Error(createError.message);
        const listingId = resultListingId(created);
        if (!listingId) throw new Error("CLOUVA no pudo resolver el borrador creado.");

        const primaryNormalized = `${identifier.type}:${identifier.value.replace(/\s/g, "").toUpperCase()}`;
        const extraIdentifierResults: Array<Record<string, unknown>> = [];
        const uniqueExtras = new Map(
          group.visibleIdentifiers
            .filter((candidate) => `${candidate.type}:${candidate.value.replace(/\s/g, "").toUpperCase()}` !== primaryNormalized)
            .map((candidate) => [`${candidate.type}:${candidate.value.replace(/\s/g, "").toUpperCase()}`, candidate] as const),
        );
        for (const candidate of uniqueExtras.values()) {
          const { data: attached, error: attachError } = await admin.rpc("create_commerce_product_identifier", {
            p_spot_id: spot.id,
            p_listing_id: listingId,
            p_listing_variant_id: null,
            p_identifier_type: candidate.type,
            p_value: candidate.value,
            p_origin: "imported",
            p_is_primary: false,
            p_actor_id: user.id,
            p_public_token: null,
            p_destination_type: "product",
            p_destination_path: null,
            p_destination_metadata: {
              source: candidate.source,
              confidence: candidate.confidence,
              batch_id: batch.id,
              group_key: group.groupKey,
            },
            p_replaces_identifier_id: null,
          });
          extraIdentifierResults.push({
            value: candidate.value,
            type: candidate.type,
            source: candidate.source,
            attached: !attachError && !Boolean(record(attached).conflict),
            conflict: Boolean(record(attached).conflict),
            error: attachError?.message ?? null,
          });
        }

        const itemRecognition = {
          group_key: group.groupKey,
          listing_id: listingId,
          name: recognizedName,
          brand: recognized.brand,
          category: recognized.category,
          package_kind: group.packageKind,
          identifier,
          visible_identifiers: group.visibleIdentifiers,
          extra_identifier_results: extraIdentifierResults,
          analyzed_at: analyzedAt,
        };
        const { error: itemUpdateError } = await admin
          .from("commerce_product_import_items")
          .update({
            status: "created",
            listing_id: listingId,
            recognition: itemRecognition,
            error: null,
            updated_at: analyzedAt,
          })
          .in("id", itemIds);
        if (itemUpdateError) throw new Error(itemUpdateError.message);

        for (const item of groupItems) {
          item.status = "created";
          item.listing_id = listingId;
          item.recognition = itemRecognition;
          item.error = null;
        }
        results.push({
          groupKey: group.groupKey,
          ok: true,
          listingId,
          name: recognizedName,
          packageKind: group.packageKind,
          identifier,
          visibleIdentifiers: group.visibleIdentifiers,
          extraIdentifierResults,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "No se pudo crear el producto.";
        await admin
          .from("commerce_product_import_items")
          .update({ status: "error", error: message, updated_at: new Date().toISOString() })
          .in("id", itemIds);
        for (const item of groupItems) {
          item.status = "error";
          item.error = message;
        }
        results.push({ groupKey: group.groupKey, ok: false, error: message });
      }
    }

    const groupStates = groups.map((group) => {
      const groupItems = group.images.flatMap((image) => {
        const item = itemsByIndex.get(image.sourceIndex);
        return item ? [item] : [];
      });
      return {
        created: groupItems.some((item) => Boolean(item.listing_id)),
        failed: groupItems.length > 0 && groupItems.every((item) => item.status === "error"),
      };
    });
    const processed = groupStates.filter((state) => state.created).length;
    const failed = groupStates.filter((state) => state.failed).length;
    const remaining = groups.length - processed - failed;
    const status = remaining > 0 ? "processing" : failed > 0 ? "completed_with_errors" : "completed";

    const { error: batchUpdateError } = await admin
      .from("commerce_product_import_batches")
      .update({
        status,
        processed_products: processed,
        failed_products: failed,
        updated_at: new Date().toISOString(),
      })
      .eq("id", batch.id);
    if (batchUpdateError) throw new Error(batchUpdateError.message);

    return NextResponse.json({
      batchId: batch.id,
      status,
      processed,
      failed,
      remaining,
      results,
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo procesar el lote." }, { status });
  }
}
