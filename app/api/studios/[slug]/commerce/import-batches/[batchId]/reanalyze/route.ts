import { NextRequest, NextResponse } from "next/server";
import {
  analyzeCommerceProductBatch,
  type CommerceBatchGroup,
} from "@/lib/server/commerce-product-batch-recognition";
import {
  reconcileCommerceInvoice,
  type CommerceInvoiceRecognition,
} from "@/lib/server/commerce-invoice-recognition";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import type { CommerceIdentifierType } from "@/lib/commerce/identifiers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function sameBatchDraft(metadata: unknown, batchId: string) {
  const root = record(metadata);
  const lifecycle = record(root.draft_lifecycle);
  return lifecycle.source === "visual_batch_import" && lifecycle.batch_id === batchId;
}

function safeBarcode(value: unknown, type: unknown) {
  if (typeof value !== "string" || !value.trim() || typeof type !== "string") return null;
  const allowed = new Set([
    "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "clouva_barcode", "clouva_qr", "sku",
  ]);
  if (!allowed.has(type)) return null;
  return { value: value.trim(), type: type as CommerceIdentifierType };
}

function invoiceRecognition(invoice: JsonRecord, items: JsonRecord[]): CommerceInvoiceRecognition {
  return {
    supplierName: typeof invoice.supplier_name === "string" ? invoice.supplier_name : "",
    supplierTaxId: typeof invoice.supplier_tax_id === "string" ? invoice.supplier_tax_id : "",
    documentType: typeof invoice.document_type === "string" ? invoice.document_type : "",
    documentNumber: typeof invoice.document_number === "string" ? invoice.document_number : "",
    issuedAt: typeof invoice.issued_at === "string" ? invoice.issued_at : "",
    currency: typeof invoice.currency === "string" ? invoice.currency : "",
    subtotal: invoice.subtotal == null ? null : Number(invoice.subtotal),
    taxAmount: invoice.tax_amount == null ? null : Number(invoice.tax_amount),
    totalAmount: invoice.total_amount == null ? null : Number(invoice.total_amount),
    lines: items.map((item, index) => ({
      lineNumber: Math.max(1, Math.floor(Number(item.line_number) || index + 1)),
      description: typeof item.description === "string" ? item.description : "",
      brand: typeof item.brand === "string" ? item.brand : "",
      model: typeof item.model === "string" ? item.model : "",
      supplierSku: typeof item.supplier_sku === "string" ? item.supplier_sku : "",
      barcode: safeBarcode(item.barcode_value, item.barcode_type),
      quantity: Math.max(1, Number(item.quantity) || 1),
      unitPrice: item.unit_price == null ? null : Number(item.unit_price),
      taxAmount: item.tax_amount == null ? null : Number(item.tax_amount),
      lineTotal: item.line_total == null ? null : Number(item.line_total),
    })),
  };
}

async function deleteDraftListings(args: {
  admin: ReturnType<typeof createAdminSupabase>;
  spotId: string;
  batchId: string;
  listingIds: string[];
}) {
  if (!args.listingIds.length) return 0;

  const { data: listings, error: listingsError } = await args.admin
    .from("commerce_products")
    .select("id,status,stock,metadata")
    .in("id", args.listingIds)
    .eq("spot_id", args.spotId);
  if (listingsError) throw new Error(listingsError.message);

  const removable = (listings ?? []).filter((listing) => sameBatchDraft(listing.metadata, args.batchId));
  if (!removable.length) return 0;

  if (removable.some((listing) => listing.status !== "draft" || Number(listing.stock || 0) !== 0)) {
    throw new Error("Este lote ya modificó productos activos o stock. No se puede reanalizar automáticamente.");
  }

  const ids = removable.map((listing) => listing.id);
  const { data: variants, error: variantsError } = await args.admin
    .from("commerce_product_variants")
    .select("id,product_id,stock")
    .in("product_id", ids);
  if (variantsError) throw new Error(variantsError.message);
  if ((variants ?? []).some((variant) => Number(variant.stock || 0) !== 0)) {
    throw new Error("Este lote ya tiene stock en variantes. No se puede reanalizar automáticamente.");
  }

  const { data: movements, error: movementError } = await args.admin
    .from("commerce_inventory_movements")
    .select("id")
    .in("listing_id", ids)
    .limit(1);
  if (movementError) throw new Error(movementError.message);
  if (movements?.length) {
    throw new Error("Este lote ya tiene movimientos de inventario. No se puede reanalizar automáticamente.");
  }

  const { data: orderItems, error: orderError } = await args.admin
    .from("commerce_order_items")
    .select("id")
    .in("product_id", ids)
    .limit(1);
  if (orderError) throw new Error(orderError.message);
  if (orderItems?.length) {
    throw new Error("Este lote ya tiene ventas asociadas. No se puede reanalizar automáticamente.");
  }

  for (let offset = 0; offset < ids.length; offset += 5) {
    const chunk = ids.slice(offset, offset + 5);
    await Promise.all(chunk.map(async (listingId) => {
      const { error } = await args.admin.rpc("hard_delete_commerce_listing", {
        p_spot_id: args.spotId,
        p_listing_id: listingId,
      });
      if (error) throw new Error(error.message);
    }));
  }

  return ids.length;
}

async function reconcileStoredInvoice(args: {
  admin: ReturnType<typeof createAdminSupabase>;
  userId: string;
  spotId: string;
  batchId: string;
  groups: CommerceBatchGroup[];
}) {
  const { data: invoice, error: invoiceError } = await args.admin
    .from("commerce_product_import_invoices")
    .select("*")
    .eq("batch_id", args.batchId)
    .eq("spot_id", args.spotId)
    .maybeSingle();
  if (invoiceError) throw new Error(invoiceError.message);
  if (!invoice) return { reconciled: false, lines: 0 };

  const { data: lines, error: linesError } = await args.admin
    .from("commerce_product_import_invoice_items")
    .select("*")
    .eq("invoice_id", invoice.id)
    .order("line_number");
  if (linesError) throw new Error(linesError.message);

  const sourceLines = (lines ?? []).map((line) => record(line));
  const matches = reconcileCommerceInvoice({
    invoice: invoiceRecognition(record(invoice), sourceLines),
    groups: args.groups,
  });
  const now = new Date().toISOString();

  for (let index = 0; index < sourceLines.length; index += 1) {
    const source = sourceLines[index];
    const match = matches[index];
    if (!match || typeof source.id !== "string") continue;
    const sourceMetadata = record(source.metadata);
    const manuallyChecked = source.checked === true && sourceMetadata.auto_checked !== true;
    const checked = manuallyChecked || match.autoChecked;
    const { error } = await args.admin
      .from("commerce_product_import_invoice_items")
      .update({
        matched_group_keys: match.matchedGroupKeys,
        matched_listing_ids: [],
        matched_quantity: match.matchedQuantity,
        match_status: match.matchStatus,
        checked,
        checked_by: checked ? args.userId : null,
        checked_at: checked ? now : null,
        metadata: {
          ...sourceMetadata,
          confidence: match.confidence,
          reasons: match.reasons,
          auto_checked: match.autoChecked,
          reconciled_after_reanalysis: true,
        },
        updated_at: now,
      })
      .eq("id", source.id);
    if (error) throw new Error(error.message);
  }

  const invoiceMetadata = record(invoice.metadata);
  const { error: updateInvoiceError } = await args.admin
    .from("commerce_product_import_invoices")
    .update({
      status: "review",
      metadata: {
        ...invoiceMetadata,
        reconciliation_version: 2,
        reanalyzed_at: now,
      },
      updated_at: now,
    })
    .eq("id", invoice.id);
  if (updateInvoiceError) throw new Error(updateInvoiceError.message);

  return { reconciled: true, lines: sourceLines.length };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; batchId: string }> },
) {
  let activeBatchId: string | null = null;
  try {
    const { user } = await requireUser(request);
    const { slug, batchId } = await params;
    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId: slug });

    const { data: batch, error: batchError } = await admin
      .from("commerce_product_import_batches")
      .select("id,status,total_images,metadata")
      .eq("id", batchId)
      .eq("spot_id", spot.id)
      .maybeSingle();
    if (batchError) throw new Error(batchError.message);
    if (!batch) return NextResponse.json({ error: "El lote no existe en este Spot." }, { status: 404 });
    activeBatchId = batch.id;

    const { data: items, error: itemsError } = await admin
      .from("commerce_product_import_items")
      .select("id,source_index,source_url,storage_path,mime_type,status,group_key,listing_id,recognition,error")
      .eq("batch_id", batch.id)
      .eq("spot_id", spot.id)
      .order("source_index");
    if (itemsError) throw new Error(itemsError.message);
    if (!items?.length || items.length !== batch.total_images) {
      return NextResponse.json({ error: "El lote no tiene todas sus fotos disponibles." }, { status: 409 });
    }

    const listingIds = Array.from(new Set(
      items.flatMap((item) => typeof item.listing_id === "string" ? [item.listing_id] : []),
    ));
    const deletedDrafts = await deleteDraftListings({
      admin,
      spotId: spot.id,
      batchId: batch.id,
      listingIds,
    });

    const metadata = record(batch.metadata);
    const reanalysisCount = Math.max(0, Number(metadata.reanalysis_count) || 0) + 1;
    const startedAt = new Date().toISOString();
    const cleanMetadata = { ...metadata };
    delete cleanMetadata.groups;
    delete cleanMetadata.analyzed_at;
    delete cleanMetadata.unit_count_overrides;

    const { error: resetItemsError } = await admin
      .from("commerce_product_import_items")
      .update({
        status: "uploaded",
        group_key: null,
        listing_id: null,
        error: null,
        updated_at: startedAt,
      })
      .eq("batch_id", batch.id)
      .eq("spot_id", spot.id);
    if (resetItemsError) throw new Error(resetItemsError.message);

    const { error: resetBatchError } = await admin
      .from("commerce_product_import_batches")
      .update({
        status: "analyzing",
        detected_products: 0,
        processed_products: 0,
        failed_products: 0,
        error: null,
        metadata: {
          ...cleanMetadata,
          reanalysis_count: reanalysisCount,
          reanalysis_started_at: startedAt,
          deleted_stale_drafts: deletedDrafts,
        },
        updated_at: startedAt,
      })
      .eq("id", batch.id);
    if (resetBatchError) throw new Error(resetBatchError.message);

    const groups = await analyzeCommerceProductBatch({
      spotName: spot.name,
      images: items.map((item) => ({
        sourceIndex: item.source_index,
        storagePath: item.storage_path,
        mimeType: item.mime_type,
      })),
    });

    const groupByIndex = new Map<number, { key: string; summary: JsonRecord }>();
    for (const group of groups) {
      for (const image of group.images) {
        groupByIndex.set(image.sourceIndex, {
          key: group.groupKey,
          summary: {
            role: image.role,
            group_name: group.name,
            brand: group.brand,
            model: group.model,
            package_kind: group.packageKind,
            unit_count: group.unitCount,
            identifier: group.identifier,
            visible_identifiers: group.visibleIdentifiers,
            confidence: group.confidence,
            needs_review: group.needsReview,
          },
        });
      }
    }

    for (const item of items) {
      const grouped = groupByIndex.get(item.source_index);
      const previous = record(item.recognition);
      const upload = record(previous.upload);
      const { error } = await admin
        .from("commerce_product_import_items")
        .update(grouped ? {
          status: "grouped",
          group_key: grouped.key,
          recognition: {
            ...(Object.keys(upload).length ? { upload } : {}),
            grouping: grouped.summary,
          },
          error: null,
          updated_at: new Date().toISOString(),
        } : {
          status: "uploaded",
          group_key: null,
          recognition: {
            ...(Object.keys(upload).length ? { upload } : {}),
            context_only: true,
          },
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      if (error) throw new Error(error.message);
    }

    const invoice = await reconcileStoredInvoice({
      admin,
      userId: user.id,
      spotId: spot.id,
      batchId: batch.id,
      groups,
    });

    const finishedAt = new Date().toISOString();
    const { error: finishError } = await admin
      .from("commerce_product_import_batches")
      .update({
        status: "review",
        detected_products: groups.length,
        processed_products: 0,
        failed_products: 0,
        error: null,
        metadata: {
          ...cleanMetadata,
          groups,
          analyzed_at: finishedAt,
          reanalysis_count: reanalysisCount,
          reanalysis_started_at: startedAt,
          reanalysis_finished_at: finishedAt,
          deleted_stale_drafts: deletedDrafts,
          invoice_reconciled: invoice.reconciled,
        },
        updated_at: finishedAt,
      })
      .eq("id", batch.id);
    if (finishError) throw new Error(finishError.message);

    return NextResponse.json({
      batchId: batch.id,
      status: "review",
      totalImages: items.length,
      detectedProducts: groups.length,
      groups,
      invoice,
      deletedDrafts,
      reanalysisCount,
    });
  } catch (error) {
    if (activeBatchId) {
      try {
        const admin = createAdminSupabase();
        await admin
          .from("commerce_product_import_batches")
          .update({
            status: "failed",
            error: error instanceof Error ? error.message : "Falló el reanálisis.",
            updated_at: new Date().toISOString(),
          })
          .eq("id", activeBatchId);
      } catch {}
    }
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo reanalizar el lote." },
      { status },
    );
  }
}
