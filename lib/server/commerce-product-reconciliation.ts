import "server-only";
import { createHash } from "node:crypto";
import { reconcileProducts, type ReconciliationGroup, type ReconciliationLine, type ReconciliationDecision } from "@/lib/commerce/product-reconciliation";
import type { createAdminSupabase } from "@/lib/server/supabase";
export const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function reconciliationDecisions(metadata: unknown): ReconciliationDecision[] {
  const value = asRecord(metadata).product_reconciliation;
  const decisions = asRecord(value).decisions;
  return Array.isArray(decisions) ? decisions as ReconciliationDecision[] : [];
}
export async function loadProductReconciliation(admin: ReturnType<typeof createAdminSupabase>, batchId: string, spotId: string) {
  const { data: batch, error } = await admin.from("commerce_product_import_batches")
    .select("id,status,metadata,updated_at,processed_products,total_images").eq("id", batchId).eq("spot_id", spotId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!batch) throw Object.assign(new Error("El lote no existe en este Spot."), { status: 404 });
  const [invoiceResult, linesResult, imagesResult, catalogResult] = await Promise.all([
    admin.from("commerce_product_import_invoices").select("id,source_url,currency").eq("batch_id", batchId).eq("spot_id", spotId).maybeSingle(),
    admin.from("commerce_product_import_invoice_items").select("*").eq("batch_id", batchId).eq("spot_id", spotId).order("line_number"),
    admin.from("commerce_product_import_items").select("id,source_index,source_url,file_name,group_key,listing_id,recognition").eq("batch_id", batchId).eq("spot_id", spotId).order("source_index"),
    admin.from("commerce_products").select("id,name,catalog_product_id").eq("spot_id", spotId).eq("product_type", "physical").order("name").limit(500),
  ]);
  for (const result of [invoiceResult, linesResult, imagesResult, catalogResult]) if (result.error) throw new Error(result.error.message);
  const metadata = asRecord(batch.metadata);
  const groups = (Array.isArray(metadata.groups) ? metadata.groups : []) as ReconciliationGroup[];
  const lines = (linesResult.data || []) as ReconciliationLine[];
  const decisions = reconciliationDecisions(metadata);
  const report = reconcileProducts(groups, lines, decisions, Boolean(invoiceResult.data));
  const revision = createHash("sha256").update(JSON.stringify([batch.updated_at, groups, lines, decisions])).digest("hex");
  return { batch, metadata, groups, lines, decisions, report, revision, invoice: invoiceResult.data, sources: imagesResult.data || [], existingProducts: catalogResult.data || [] };
}
export function reconciliationPayload(state: Awaited<ReturnType<typeof loadProductReconciliation>>) {
  return { report: state.report, revision: state.revision, groups: state.groups, invoice: state.invoice,
    sources: state.sources, lines: state.lines, existingProducts: state.existingProducts, existingLinks: asRecord(state.metadata.existing_product_links),
    editable: state.batch.status === "review" && !state.batch.processed_products && !state.sources.some(s => s.listing_id),
    decisions: state.decisions.map(({ signature: _signature, ...decision }) => decision) };
}
