import { NextRequest, NextResponse } from "next/server";
import { analyzeCommerceProductBatch } from "@/lib/server/commerce-product-batch-recognition";
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
    if (existingGroups.length) {
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
      .select("id,source_index,source_url,storage_path,mime_type,status")
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

    const groups = await analyzeCommerceProductBatch({
      spotName: spot.name,
      images: items.map((item) => ({
        sourceIndex: item.source_index,
        storagePath: item.storage_path,
        mimeType: item.mime_type,
      })),
    });

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
    const metadata = {
      ...(batch.metadata && typeof batch.metadata === "object" ? batch.metadata : {}),
      groups,
      analyzed_at: analyzedAt,
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
