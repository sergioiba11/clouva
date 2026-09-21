import { NextRequest, NextResponse } from "next/server";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; batchId: string }> },
) {
  try {
    const { user } = await requireUser(request);
    const { slug, batchId } = await params;
    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId: slug });

    const { data: batch, error } = await admin
      .from("commerce_product_import_batches")
      .select("id,status,total_images,detected_products,processed_products,failed_products,error,metadata,created_at,updated_at")
      .eq("id", batchId)
      .eq("spot_id", spot.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!batch) return NextResponse.json({ error: "El lote no existe en este Spot." }, { status: 404 });

    const { data: items, error: itemsError } = await admin
      .from("commerce_product_import_items")
      .select("id,source_index,file_name,source_url,mime_type,status,group_key,listing_id,error")
      .eq("batch_id", batch.id)
      .eq("spot_id", spot.id)
      .order("source_index");
    if (itemsError) throw new Error(itemsError.message);

    return NextResponse.json({ batch: { ...batch, items: items ?? [] } });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo cargar el lote." },
      { status },
    );
  }
}


export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; batchId: string }> },
) {
  try {
    const { user } = await requireUser(request);
    const { slug, batchId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      groupKey?: unknown;
      unitCount?: unknown;
    };
    const groupKey = typeof body.groupKey === "string" ? body.groupKey.trim() : "";
    const unitCount = Math.max(1, Math.min(100, Math.floor(Number(body.unitCount) || 0)));
    if (!groupKey || !unitCount) {
      return NextResponse.json({ error: "Falta el producto o la cantidad." }, { status: 400 });
    }

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

    const metadata = batch.metadata && typeof batch.metadata === "object" && !Array.isArray(batch.metadata)
      ? batch.metadata as Record<string, unknown>
      : {};
    const groups = Array.isArray(metadata.groups) ? metadata.groups : [];
    let found = false;
    const nextGroups = groups.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
      const group = raw as Record<string, unknown>;
      if (group.groupKey !== groupKey) return group;
      found = true;
      return { ...group, unitCount };
    });
    if (!found) return NextResponse.json({ error: "El producto no pertenece al lote." }, { status: 404 });

    const overrides = metadata.unit_count_overrides && typeof metadata.unit_count_overrides === "object" && !Array.isArray(metadata.unit_count_overrides)
      ? metadata.unit_count_overrides as Record<string, unknown>
      : {};
    const updatedAt = new Date().toISOString();
    const nextMetadata = {
      ...metadata,
      groups: nextGroups,
      unit_count_overrides: {
        ...overrides,
        [groupKey]: { unit_count: unitCount, actor_id: user.id, updated_at: updatedAt },
      },
    };
    const { error: updateError } = await admin
      .from("commerce_product_import_batches")
      .update({ metadata: nextMetadata, updated_at: updatedAt })
      .eq("id", batch.id);
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ groupKey, unitCount });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo actualizar la cantidad." },
      { status },
    );
  }
}
