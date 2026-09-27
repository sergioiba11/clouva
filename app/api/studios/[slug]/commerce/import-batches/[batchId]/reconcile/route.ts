import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { reconciliationBasis, reconcileProducts, applyReconciliationDecision, type ReconciliationDecision } from "@/lib/commerce/product-reconciliation";
import { asRecord, loadProductReconciliation, reconciliationPayload } from "@/lib/server/commerce-product-reconciliation";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const failure = (error: unknown) => NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo revisar el producto." },
  { status: (error as Error & { status?: number })?.status || (isAuthError(error) ? 401 : 500) });
async function context(request: NextRequest, params: Promise<{ slug: string; batchId: string }>) {
  const { user } = await requireUser(request);
  const { slug, batchId } = await params;
  const admin = createAdminSupabase();
  const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId: slug });
  return { user, admin, spot, batchId };
}
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string; batchId: string }> }) {
  try {
    const { admin, spot, batchId } = await context(request, params);
    return NextResponse.json(reconciliationPayload(await loadProductReconciliation(admin, batchId, spot.id)));
  } catch (error) { return failure(error); }
}
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string; batchId: string }> }) {
  try {
    const { user, admin, spot, batchId } = await context(request, params);
    const body = asRecord(await request.json());
    const state = await loadProductReconciliation(admin, batchId, spot.id);
    if (!reconciliationPayload(state).editable) return NextResponse.json({ error: "La recepción ya está en proceso o ingresada." }, { status: 409 });
    const actionId = typeof body.actionId === "string" ? body.actionId : "";
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(actionId)) return NextResponse.json({ error: "Falta el identificador de confirmación." }, { status: 400 });
    if (state.decisions.some(d => d.id === actionId)) return NextResponse.json(reconciliationPayload(state));
    if (body.revision !== state.revision) return NextResponse.json({ error: "La revisión cambió. Actualizá y confirmá de nuevo." }, { status: 409 });
    if (body.kind === "link") {
      if (!state.groups.some(g => g.groupKey === body.groupKey)) return NextResponse.json({ error: "Producto inexistente." }, { status: 400 });
      const listingId = typeof body.listingId === "string" ? body.listingId : "";
      if (listingId && !state.existingProducts.some(p => p.id === listingId)) return NextResponse.json({ error: "El artículo no pertenece a este Spot." }, { status: 400 });
      if (listingId) {
        const { data: variants, error: variantError } = await admin.from("commerce_product_variants").select("id").eq("product_id", listingId).eq("active", true).limit(1);
        if (variantError) throw new Error(variantError.message);
        if (variants?.length) return NextResponse.json({ error: "Este artículo tiene variantes. Identificá la variante con su código." }, { status: 400 });
      }
      const { data: saved, error: saveError } = await admin.from("commerce_product_import_batches").update({
        metadata: { ...state.metadata, existing_product_links: { ...asRecord(state.metadata.existing_product_links), [String(body.groupKey)]: { listingId, basis: reconciliationBasis(state.groups, state.lines), actorId: user.id } } }, updated_at: new Date().toISOString(),
      }).eq("id", batchId).eq("spot_id", spot.id).eq("status", "review").eq("updated_at", state.batch.updated_at).select("id").maybeSingle();
      if (saveError) throw new Error(saveError.message);
      if (!saved) return NextResponse.json({ error: "La recepción cambió. Actualizá la revisión." }, { status: 409 });
      return NextResponse.json(reconciliationPayload(await loadProductReconciliation(admin, batchId, spot.id)));
    }
    let decisions: ReconciliationDecision[];
    try {
      decisions = applyReconciliationDecision({ groups: state.groups, lines: state.lines, decisions: state.decisions,
        kind: body.kind as ReconciliationDecision["kind"], groupKey: typeof body.groupKey === "string" ? body.groupKey : undefined,
        lineId: typeof body.lineId === "string" ? body.lineId : undefined, quantity: Number(body.quantity ?? 1),
        amount: body.amount == null ? undefined : Number(body.amount), id: actionId, actorId: user.id, now: new Date().toISOString() });
      // Receiving an extra also explicitly confirms that physical product.
      const after = reconcileProducts(state.groups, state.lines, decisions).products.find(p => p.groupKey === body.groupKey);
      if ((body.kind === "extra" || body.kind === "reassign") && after && after.extra === after.unbilled) {
        decisions = applyReconciliationDecision({ groups: state.groups, lines: state.lines, decisions,
          kind: "review", groupKey: String(body.groupKey), id: randomUUID(), actorId: user.id, now: new Date().toISOString() });
      }
    } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
    const { data, error } = await admin.from("commerce_product_import_batches")
      .update({ metadata: { ...state.metadata, product_reconciliation: { version: 1, decisions } }, updated_at: new Date().toISOString() })
      .eq("id", batchId).eq("spot_id", spot.id).eq("status", "review").eq("updated_at", state.batch.updated_at).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Otro cambio llegó primero. Actualizá la revisión." }, { status: 409 });
    return NextResponse.json(reconciliationPayload(await loadProductReconciliation(admin, batchId, spot.id)));
  } catch (error) { return failure(error); }
}
