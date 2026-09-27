import { NextRequest, NextResponse } from "next/server";
import { uploadGeneratedMediaObject } from "@/lib/gcs-media";
import { decodeBarcodesFromImageBytes } from "@/lib/server/commerce-barcode-decode";
import { loadProductReconciliation, reconciliationPayload, asRecord } from "@/lib/server/commerce-product-reconciliation";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import type { EvidenceRole } from "@/lib/commerce/product-reconciliation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string; batchId: string }> }) {
  const admin = createAdminSupabase();
  let claim: { batchId: string; spotId: string; at: string; itemId?: string } | null = null;
  try {
    const { user } = await requireUser(request);
    const { slug, batchId } = await params;
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId: slug });
    const body = asRecord(await request.json());
    const state = await loadProductReconciliation(admin, batchId, spot.id);
    if (!reconciliationPayload(state).editable || body.revision !== state.revision) return NextResponse.json({ error: "La revisión cambió. Actualizá el producto." }, { status: 409 });
    const role = body.role as EvidenceRole;
    const group = state.groups.find(g => g.groupKey === body.groupKey);
    if (!group || !["front", "back", "code", "other"].includes(role)) return NextResponse.json({ error: "Foto o producto inválido." }, { status: 400 });
    const match = String(body.dataUrl || "").match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\r\n]+)$/i);
    if (!match) return NextResponse.json({ error: "Usá una imagen JPG, PNG o WEBP." }, { status: 400 });
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) return NextResponse.json({ error: "La foto debe pesar hasta 5 MB." }, { status: 400 });
    const index = Math.max(-1, ...state.sources.map(s => s.source_index)) + 1;
    if (index >= 80) return NextResponse.json({ error: "Este lote ya tiene 80 fotos." }, { status: 400 });
    const stored = await uploadGeneratedMediaObject({ bytes, mimeType: match[1], pathPrefix: `commerce/${spot.id}/bulk-import/${batchId}` });
    const at = new Date().toISOString();
    const { data: locked, error: lockError } = await admin.from("commerce_product_import_batches")
      .update({ status: "analyzing", updated_at: at }).eq("id", batchId).eq("spot_id", spot.id)
      .eq("status", "review").eq("updated_at", state.batch.updated_at).select("id").maybeSingle();
    if (lockError) throw new Error(lockError.message);
    if (!locked) return NextResponse.json({ error: "Otro cambio llegó primero. Actualizá el producto." }, { status: 409 });
    claim = { batchId, spotId: spot.id, at };
    const decoded = await decodeBarcodesFromImageBytes(bytes).catch(() => []);
    const imageRole = role === "front" ? "Frente" : role === "back" ? "Atrás" : "Detalle";
    const nextGroups = state.groups.map(g => g.groupKey !== group.groupKey ? g : { ...g,
      images: [...g.images, { sourceIndex: index, role: imageRole, evidenceRole: role }],
      visibleIdentifiers: [...(g.visibleIdentifiers || []), ...decoded.map(code => ({ ...code, sourceIndex: index, source: "product", confidence: 1 }))],
    });
    const { data: item, error: itemError } = await admin.from("commerce_product_import_items").insert({
      batch_id: batchId, spot_id: spot.id, source_index: index, file_name: String(body.fileName || "Foto").slice(0, 240),
      source_url: stored.url, storage_path: stored.objectPath, mime_type: match[1], status: "grouped", group_key: group.groupKey,
      recognition: { evidence_role: role, attached_by: user.id },
    }).select("id").single();
    if (itemError) throw new Error(itemError.message);
    claim.itemId = item.id;
    const { data: saved, error: saveError } = await admin.from("commerce_product_import_batches").update({
      status: "review", metadata: { ...state.metadata, groups: nextGroups }, total_images: state.sources.length + 1, updated_at: new Date().toISOString(),
    }).eq("id", batchId).eq("spot_id", spot.id).eq("status", "analyzing").eq("updated_at", at).select("id").maybeSingle();
    if (saveError || !saved) throw new Error(saveError?.message || "No se pudo guardar la foto en el producto.");
    claim = null;
    return NextResponse.json(reconciliationPayload(await loadProductReconciliation(admin, batchId, spot.id)));
  } catch (error) {
    if (claim) {
      if (claim.itemId) await admin.from("commerce_product_import_items").delete().eq("id", claim.itemId).eq("batch_id", claim.batchId).eq("spot_id", claim.spotId);
      await admin.from("commerce_product_import_batches").update({ status: "review", updated_at: new Date().toISOString() }).eq("id", claim.batchId).eq("spot_id", claim.spotId).eq("updated_at", claim.at);
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo agregar la foto." }, { status: isAuthError(error) ? 401 : (error as Error & { status?: number })?.status || 500 });
  }
}
