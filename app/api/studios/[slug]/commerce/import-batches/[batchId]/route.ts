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
