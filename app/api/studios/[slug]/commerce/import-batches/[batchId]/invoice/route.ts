import { NextRequest, NextResponse } from "next/server";
import { uploadGeneratedMediaObject } from "@/lib/gcs-media";
import {
  recognizeCommerceInvoice,
  reconcileCommerceInvoice,
} from "@/lib/server/commerce-invoice-recognition";
import type { CommerceBatchGroup } from "@/lib/server/commerce-product-batch-recognition";
import { validateCommerceIdentifier, type CommerceIdentifierType } from "@/lib/commerce/identifiers";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseDocumentDataUrl(value: unknown) {
  if (typeof value !== "string") throw new Error("Falta la factura.");
  const match = value.match(/^data:([a-z0-9.+/-]+);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) throw new Error("La factura no tiene un formato válido.");
  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_MIME.has(mimeType)) throw new Error("Usá factura JPG, PNG, WEBP o PDF.");
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES) {
    throw new Error("La factura debe pesar hasta 12 MB.");
  }
  return { bytes, mimeType };
}

function safeIdentifier(value: unknown) {
  const raw = record(value);
  const rawValue = typeof raw.value === "string" ? raw.value.trim() : "";
  const rawType = typeof raw.type === "string" ? raw.type as CommerceIdentifierType : null;
  if (!rawValue || !rawType) return null;
  const supported = new Set<CommerceIdentifierType>([
    "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "clouva_barcode", "clouva_qr", "sku",
  ]);
  if (!supported.has(rawType)) return null;
  const validation = validateCommerceIdentifier(rawType, rawValue);
  return validation.valid ? { value: validation.value, type: rawType } : null;
}

function groupsFromMetadata(metadata: unknown): CommerceBatchGroup[] {
  const root = record(metadata);
  if (!Array.isArray(root.groups)) return [];
  return root.groups.flatMap((raw) => {
    const group = record(raw);
    const groupKey = typeof group.groupKey === "string" ? group.groupKey : "";
    const images = Array.isArray(group.images) ? group.images.flatMap((rawImage) => {
      const image = record(rawImage);
      const sourceIndex = Number(image.sourceIndex);
      if (!Number.isInteger(sourceIndex)) return [];
      const role: CommerceBatchGroup["images"][number]["role"] =
        image.role === "Atrás" ? "Atrás" : image.role === "Detalle" ? "Detalle" : "Frente";
      return [{ sourceIndex, role }];
    }) : [];
    if (!groupKey || !images.length) return [];

    const visibleIdentifiers = Array.isArray(group.visibleIdentifiers)
      ? group.visibleIdentifiers.flatMap((rawCode) => {
          const code = record(rawCode);
          const identifier = safeIdentifier(code);
          if (!identifier) return [];
          const source: CommerceBatchGroup["visibleIdentifiers"][number]["source"] = code.source === "box" ? "box" : code.source === "product" ? "product" : "unknown";
          return [{
            ...identifier,
            source,
            confidence: Math.max(0, Math.min(1, Number(code.confidence || 0))),
          }];
        })
      : [];

    const packageKind: CommerceBatchGroup["packageKind"] =
      group.packageKind === "box"
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
      unitCount: Math.max(1, Math.min(100, Math.floor(Number(group.unitCount) || 1))),
      identifier: safeIdentifier(group.identifier),
      visibleIdentifiers,
      confidence: Number(group.confidence || 0),
      needsReview: group.needsReview === true,
      images,
    } satisfies CommerceBatchGroup];
  });
}

function parseIssuedAt(value: string) {
  const raw = value.trim();
  if (!raw) return null;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  const latin = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (!latin) return null;
  const [, dd, mm, yy] = latin;
  const year = yy.length === 2 ? Number(`20${yy}`) : Number(yy);
  const parsed = new Date(Date.UTC(year, Number(mm) - 1, Number(dd), 12));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function loadInvoice(admin: ReturnType<typeof createAdminSupabase>, batchId: string, spotId: string) {
  const { data: invoice, error } = await admin
    .from("commerce_product_import_invoices")
    .select("*")
    .eq("batch_id", batchId)
    .eq("spot_id", spotId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!invoice) return { invoice: null, items: [] };

  const { data: items, error: itemsError } = await admin
    .from("commerce_product_import_invoice_items")
    .select("*")
    .eq("invoice_id", invoice.id)
    .order("line_number");
  if (itemsError) throw new Error(itemsError.message);
  return { invoice, items: items ?? [] };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; batchId: string }> },
) {
  try {
    const { user } = await requireUser(request);
    const { slug, batchId } = await params;
    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId: slug });
    return NextResponse.json(await loadInvoice(admin, batchId, spot.id));
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cargar la factura." }, { status });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; batchId: string }> },
) {
  try {
    const { user } = await requireUser(request);
    const { slug, batchId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      fileName?: unknown;
      dataUrl?: unknown;
    };

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId: slug });
    const { data: batch, error: batchError } = await admin
      .from("commerce_product_import_batches")
      .select("id,metadata")
      .eq("id", batchId)
      .eq("spot_id", spot.id)
      .maybeSingle();
    if (batchError) throw new Error(batchError.message);
    if (!batch) return NextResponse.json({ error: "El lote no existe en este Spot." }, { status: 404 });

    const parsed = parseDocumentDataUrl(body.dataUrl);
    const fileName = typeof body.fileName === "string" ? body.fileName.trim().slice(0, 240) : "factura";
    const stored = await uploadGeneratedMediaObject({
      bytes: parsed.bytes,
      mimeType: parsed.mimeType,
      pathPrefix: `commerce/${spot.id}/bulk-import/${batch.id}/invoice`,
    });

    const analysis = await recognizeCommerceInvoice({
      bytes: parsed.bytes,
      mimeType: parsed.mimeType,
      spotName: spot.name,
    });
    const groups = groupsFromMetadata(batch.metadata);
    const reconciliation = reconcileCommerceInvoice({
      invoice: analysis.recognition,
      groups,
    });

    const now = new Date().toISOString();
    const invoicePayload = {
      batch_id: batch.id,
      spot_id: spot.id,
      file_name: fileName,
      source_url: stored.url,
      storage_path: stored.objectPath,
      mime_type: parsed.mimeType,
      status: "review",
      supplier_name: analysis.recognition.supplierName || null,
      supplier_tax_id: analysis.recognition.supplierTaxId || null,
      document_type: analysis.recognition.documentType || null,
      document_number: analysis.recognition.documentNumber || null,
      issued_at: parseIssuedAt(analysis.recognition.issuedAt),
      currency: analysis.recognition.currency || spot.currency || null,
      subtotal: analysis.recognition.subtotal,
      tax_amount: analysis.recognition.taxAmount,
      total_amount: analysis.recognition.totalAmount,
      metadata: {
        provider: analysis.provider,
        model: analysis.model,
        usage: analysis.usage,
        recognized_issued_at: analysis.recognition.issuedAt || null,
        detected_lines: analysis.recognition.lines.length,
        reconciliation_version: 1,
      },
      error: null,
      created_by: user.id,
      updated_at: now,
    };

    const { data: invoice, error: invoiceError } = await admin
      .from("commerce_product_import_invoices")
      .upsert(invoicePayload, { onConflict: "batch_id" })
      .select("*")
      .single();
    if (invoiceError) throw new Error(invoiceError.message);

    const deleted = await admin
      .from("commerce_product_import_invoice_items")
      .delete()
      .eq("invoice_id", invoice.id);
    if (deleted.error) throw new Error(deleted.error.message);

    if (reconciliation.length) {
      const rows = reconciliation.map((match) => ({
        invoice_id: invoice.id,
        batch_id: batch.id,
        spot_id: spot.id,
        line_number: match.line.lineNumber,
        description: match.line.description,
        brand: match.line.brand || null,
        model: match.line.model || null,
        supplier_sku: match.line.supplierSku || null,
        barcode_value: match.line.barcode?.value ?? null,
        barcode_type: match.line.barcode?.type ?? null,
        quantity: match.line.quantity,
        unit_price: match.line.unitPrice,
        tax_amount: match.line.taxAmount,
        line_total: match.line.lineTotal,
        matched_group_keys: match.matchedGroupKeys,
        matched_listing_ids: [],
        matched_quantity: match.matchedQuantity,
        match_status: match.matchStatus,
        checked: match.autoChecked,
        checked_by: match.autoChecked ? user.id : null,
        checked_at: match.autoChecked ? now : null,
        metadata: {
          confidence: match.confidence,
          reasons: match.reasons,
          auto_checked: match.autoChecked,
        },
        updated_at: now,
      }));
      const inserted = await admin
        .from("commerce_product_import_invoice_items")
        .insert(rows);
      if (inserted.error) throw new Error(inserted.error.message);
    }

    const batchMetadata = record(batch.metadata);
    const { error: batchUpdateError } = await admin
      .from("commerce_product_import_batches")
      .update({
        metadata: {
          ...batchMetadata,
          invoice: {
            id: invoice.id,
            source_url: stored.url,
            supplier_name: analysis.recognition.supplierName,
            document_number: analysis.recognition.documentNumber,
            total_amount: analysis.recognition.totalAmount,
            currency: analysis.recognition.currency || spot.currency,
            detected_lines: analysis.recognition.lines.length,
            reconciled_at: now,
          },
        },
        updated_at: now,
      })
      .eq("id", batch.id);
    if (batchUpdateError) throw new Error(batchUpdateError.message);

    return NextResponse.json(await loadInvoice(admin, batch.id, spot.id), { status: 201 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo analizar la factura." }, { status });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; batchId: string }> },
) {
  try {
    const { user } = await requireUser(request);
    const { slug, batchId } = await params;
    const body = (await request.json().catch(() => ({}))) as { itemId?: unknown; checked?: unknown };
    const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
    if (!itemId || typeof body.checked !== "boolean") {
      return NextResponse.json({ error: "Falta el ítem o el estado del check." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId: slug });
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("commerce_product_import_invoice_items")
      .update({
        checked: body.checked,
        checked_by: body.checked ? user.id : null,
        checked_at: body.checked ? now : null,
        updated_at: now,
      })
      .eq("id", itemId)
      .eq("batch_id", batchId)
      .eq("spot_id", spot.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "El ítem de factura no existe." }, { status: 404 });
    return NextResponse.json({ item: data });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar el check." }, { status });
  }
}
