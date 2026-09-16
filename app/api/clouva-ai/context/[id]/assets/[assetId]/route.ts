import { NextRequest, NextResponse } from "next/server";
import { deleteGeneratedMedia } from "@/lib/gcs-media";
import { publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ownedAsset(admin: Awaited<ReturnType<typeof requireMediaAdmin>>["admin"], userId: string, contextId: string, assetId: string) {
  const { data, error } = await admin.from("clouai_context_assets")
    .select("id,storage_path,is_primary,position,priority")
    .eq("id", assetId).eq("context_id", contextId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error("No se pudo consultar la referencia.");
  return data;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { id, assetId } = await context.params;
    if (!(await ownedAsset(admin, user.id, id, assetId))) return NextResponse.json({ error: "La referencia no existe.", code: "asset_not_found" }, { status: 404 });
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    if (typeof body.isPrimary === "boolean") updates.is_primary = body.isPrimary;
    if (Number.isInteger(body.position)) updates.position = Math.max(0, Number(body.position));
    if (Number.isInteger(body.priority)) updates.priority = Math.max(-100, Math.min(100, Number(body.priority)));
    if (!Object.keys(updates).length) return NextResponse.json({ error: "No hay cambios válidos.", code: "empty_update" }, { status: 400 });
    const { data, error } = await admin.from("clouai_context_assets").update(updates)
      .eq("id", assetId).eq("context_id", id).eq("user_id", user.id)
      .select("id,context_id,name,kind,storage_path,public_url,mime_type,width,height,byte_size,position,priority,is_primary,metadata_json,created_at").single();
    if (error) throw new Error("No se pudo actualizar la referencia.");
    await admin.from("clouai_contexts").update({ summary_state: "stale", updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
    return NextResponse.json({ asset: data });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const { admin, user } = await requireMediaAdmin(request);
    const { id, assetId } = await context.params;
    const asset = await ownedAsset(admin, user.id, id, assetId);
    if (!asset) return NextResponse.json({ error: "La referencia no existe.", code: "asset_not_found" }, { status: 404 });
    const { error } = await admin.from("clouai_context_assets").delete().eq("id", assetId).eq("context_id", id).eq("user_id", user.id);
    if (error) throw new Error("No se pudo eliminar la referencia.");
    await admin.from("clouai_contexts").update({ summary_state: "stale", updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
    await deleteGeneratedMedia(String(asset.storage_path)).catch(() => undefined);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
