import { NextRequest, NextResponse } from "next/server";
import { analyzeCommerceProductBatch } from "@/lib/server/commerce-product-batch-recognition";
import { reconcileCommerceInvoice, type CommerceInvoiceRecognition } from "@/lib/server/commerce-invoice-recognition";
import type { CommerceIdentifierType } from "@/lib/commerce/identifiers";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; batchId: string }> },
) {
  let authorizedBatchId: string | null = null;
  try {
    const { user } = await requireUser(request);
    const { slug, batchId } = await params;
    const body = (await request.json().catch(() => ({}))) as { force?: unknown };
    const force = body.force === true;
    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId: slug });

    const { data: batch, error: batchError } = await admin
      .from("commerce_product_import_batches")
      .select("id,status,total_images,detected_products,metadata")
      .eq("id", batchId)
      .eq("spot_id", spot.id)
      .maybeSingle();
    if (batchError) throw new Error(batchError.message);
    if (!batch) return NextResponse.json({ error: "El lote no existe en este Spot." }, { status: 404 });
    authorizedBatchId = batch.id;

    const existingMetadata = batch.metadata && typeof batch.metadata === "object" && !Array.isArray(batch.metadata)
      ? batch.metadata as Record<string, unknown>
      : {};
    const existingGroups = Array.isArray(existingMetadata.groups) ? existingMetadata.groups : [];
    if (existingGroups.length && !force) {
      return NextResponse.json({
        batchId: batch.id,
        status: batch.status,
        totalImages: batch.total_images,
        detectedProducts: Number(batch.detected_products || existingGroups.length),
        groups: existingGroups,
        recovered: true,
      });
    }

    const { data: items, error: itemsError } = await admin
      .from("commerce_product_import_items")
      .select("id,source_index,source_url,storage_path,mime_type,status,recognition")
      .eq("batch_id", batch.id)
      .eq("spot_id", spot.id)
      .order("source_index");
    if (itemsError) throw new Error(itemsError.message);
    if (!items?.length) return NextResponse.json({ error: "El lote todavía no tiene imágenes." }, { status: 400 });
    if (items.length !== batch.total_images) {
      return NextResponse.json({
        error: `Faltan imágenes por subir: ${items.length}/${batch.total_images}.`,
      }, { status: 409 });
    }

    await admin
      .from("commerce_product_import_batches")
      .update({ status: "analyzing", error: null, updated_at: new Date().toISOString() })
      .eq("id", batch.id);

    const hashOwner = new Map<string, number>();
    const duplicateIndexes = new Map<number, number[]>();
    const representativeItems = items.filter((item) => {
      const recognition = item.recognition && typeof item.recognition === "object" && !Array.isArray(item.recognition)
        ? item.recognition as Record<string, unknown>
        : {};
      const upload = recognition.upload && typeof recognition.upload === "object" && !Array.isArray(recognition.upload)
        ? recognition.upload as Record<string, unknown>
        : {};
      const sha256 = typeof upload.sha256 === "string" ? upload.sha256 : "";
      if (!sha256) return true;
      const owner = hashOwner.get(sha256);
      if (owner == null) {
        hashOwner.set(sha256, item.source_index);
        return true;
      }
      duplicateIndexes.set(owner, [...(duplicateIndexes.get(owner) ?? []), item.source_index]);
      return false;
    });

    const { data: expectedInvoiceRows, error: expectedInvoiceRowsError } = await admin
      .from("commerce_product_import_invoice_items")
      .select("description,brand,model,supplier_sku,quantity")
      .eq("batch_id", batch.id)
      .eq("spot_id", spot.id)
      .order("line_number");
    if (expectedInvoiceRowsError) throw new Error(expectedInvoiceRowsError.message);

    const groups = await analyzeCommerceProductBatch({
      spotName: spot.name,
      expectedProducts: (expectedInvoiceRows ?? []).map((line) => ({
        description: line.description || "",
        brand: line.brand || "",
        model: line.model || "",
        supplierSku: line.supplier_sku || "",
        quantity: Math.max(1, Number(line.quantity) || 1),
      })),
      images: representativeItems.map((item) => ({
        sourceIndex: item.source_index,
        storagePath: item.storage_path,
        mimeType: item.mime_type,
      })),
      onProgress: async (progress) => {
        await admin
          .from("commerce_product_import_batches")
          .update({
            metadata: {
              ...existingMetadata,
              groups: existingGroups,
              analysis_progress: progress,
              reanalyzed: false,
            },
            updated_at: progress.updatedAt,
          })
          .eq("id", batch.id);
      },
    });

    for (const group of groups) {
      const additions: Array<{ sourceIndex: number; role: "Detalle" }> = [];
      for (const image of group.images) {
        for (const duplicateIndex of duplicateIndexes.get(image.sourceIndex) ?? []) {
          additions.push({ sourceIndex: duplicateIndex, role: "Detalle" });
        }
      }
      if (additions.length) group.images.push(...additions);
    }

    const groupByIndex = new Map<number, { key: string; summary: Record<string, unknown> }>();
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
      if (!grouped) continue;
      const { error } = await admin
        .from("commerce_product_import_items")
        .update({
          status: "grouped",
          group_key: grouped.key,
          recognition: grouped.summary,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", item.id);
      if (error) throw new Error(error.message);
    }

    const analyzedAt = new Date().toISOString();

    const { data: invoice } = await admin
      .from("commerce_product_import_invoices")
      .select("id,supplier_name,supplier_tax_id,document_type,document_number,issued_at,currency,subtotal,tax_amount,total_amount")
      .eq("batch_id", batch.id)
      .eq("spot_id", spot.id)
      .maybeSingle();

    if (invoice) {
      const { data: invoiceRows, error: invoiceRowsError } = await admin
        .from("commerce_product_import_invoice_items")
        .select("id,line_number,description,brand,model,supplier_sku,barcode_value,barcode_type,quantity,unit_price,tax_amount,line_total,checked,checked_by")
        .eq("invoice_id", invoice.id)
        .order("line_number");
      if (invoiceRowsError) throw new Error(invoiceRowsError.message);

      const recognition: CommerceInvoiceRecognition = {
        supplierName: invoice.supplier_name || "",
        supplierTaxId: invoice.supplier_tax_id || "",
        documentType: invoice.document_type || "",
        documentNumber: invoice.document_number || "",
        issuedAt: invoice.issued_at || "",
        currency: invoice.currency || "",
        subtotal: invoice.subtotal == null ? null : Number(invoice.subtotal),
        taxAmount: invoice.tax_amount == null ? null : Number(invoice.tax_amount),
        totalAmount: invoice.total_amount == null ? null : Number(invoice.total_amount),
        lines: (invoiceRows ?? []).map((row) => ({
          lineNumber: Number(row.line_number),
          description: row.description || "",
          brand: row.brand || "",
          model: row.model || "",
          supplierSku: row.supplier_sku || "",
          barcode: row.barcode_value && row.barcode_type
            ? { value: row.barcode_value, type: row.barcode_type as CommerceIdentifierType }
            : null,
          quantity: Number(row.quantity || 1),
          unitPrice: row.unit_price == null ? null : Number(row.unit_price),
          taxAmount: row.tax_amount == null ? null : Number(row.tax_amount),
          lineTotal: row.line_total == null ? null : Number(row.line_total),
        })),
      };
      const reconciled = reconcileCommerceInvoice({ invoice: recognition, groups });
      const rowByLine = new Map((invoiceRows ?? []).map((row) => [Number(row.line_number), row]));
      for (const match of reconciled) {
        const row = rowByLine.get(match.line.lineNumber);
        if (!row) continue;
        const wasChecked = row.checked === true;
        const { error: rowUpdateError } = await admin
          .from("commerce_product_import_invoice_items")
          .update({
            matched_group_keys: match.matchedGroupKeys,
            matched_quantity: match.matchedQuantity,
            match_status: match.matchStatus,
            checked: wasChecked || match.autoChecked,
            checked_by: wasChecked ? row.checked_by : match.autoChecked ? user.id : null,
            checked_at: wasChecked || match.autoChecked ? analyzedAt : null,
            metadata: {
              confidence: match.confidence,
              reasons: match.reasons,
              auto_checked: match.autoChecked,
              reconciled_after_reanalysis: true,
            },
            updated_at: analyzedAt,
          })
          .eq("id", row.id);
        if (rowUpdateError) throw new Error(rowUpdateError.message);
      }

      await admin
        .from("commerce_product_import_invoices")
        .update({
          metadata: {
            reanalyzed_at: analyzedAt,
            reconciliation_version: 2,
          },
          updated_at: analyzedAt,
        })
        .eq("id", invoice.id);
    }

    const metadata = {
      ...(batch.metadata && typeof batch.metadata === "object" ? batch.metadata : {}),
      groups,
      analyzed_at: analyzedAt,
      reanalyzed: force,
      analysis_progress: {
        stage: "done",
        completed: groups.length,
        total: groups.length,
        provisionalProducts: groups.length,
        message: `${groups.length} productos listos`,
        updatedAt: analyzedAt,
      },
    };
    const { error: updateError } = await admin
      .from("commerce_product_import_batches")
      .update({
        status: "review",
        detected_products: groups.length,
        metadata,
        error: null,
        updated_at: analyzedAt,
      })
      .eq("id", batch.id);
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({
      batchId: batch.id,
      status: "review",
      totalImages: items.length,
      detectedProducts: groups.length,
      groups,
      reanalyzed: force,
    });
  } catch (error) {
    if (authorizedBatchId) {
      try {
        const admin = createAdminSupabase();
        await admin
          .from("commerce_product_import_batches")
          .update({
            status: "failed",
            error: error instanceof Error ? error.message : "Falló el análisis.",
            updated_at: new Date().toISOString(),
          })
          .eq("id", authorizedBatchId);
      } catch {}
    }
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo analizar el lote." }, { status });
  }
}
