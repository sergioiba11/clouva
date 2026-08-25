import { NextRequest, NextResponse } from "next/server";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RestoreBody = { listingId?: unknown };

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const body = (await request.json().catch(() => ({}))) as RestoreBody;
    const listingId = typeof body.listingId === "string" ? body.listingId.trim() : "";
    if (!listingId) return NextResponse.json({ error: "Falta el producto a reactivar." }, { status: 400 });

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });

    const { data: listing, error: listingError } = await admin
      .from("commerce_products")
      .select("id,spot_id,status,name")
      .eq("id", listingId)
      .eq("spot_id", spot.id)
      .maybeSingle();
    if (listingError) throw new Error(listingError.message);
    if (!listing) return NextResponse.json({ error: "Ese producto no pertenece a este MI SPOT." }, { status: 404 });
    if (listing.status !== "archived") {
      return NextResponse.json({ ok: true, listingId: listing.id, status: listing.status, unchanged: true });
    }

    const now = new Date().toISOString();
    const { error: productError } = await admin
      .from("commerce_products")
      .update({ status: "draft", updated_at: now })
      .eq("id", listing.id)
      .eq("spot_id", spot.id)
      .eq("status", "archived");
    if (productError) throw new Error(productError.message);

    const { error: variantError } = await admin
      .from("commerce_product_variants")
      .update({ active: true })
      .eq("product_id", listing.id);
    if (variantError) throw new Error(variantError.message);

    return NextResponse.json({ ok: true, listingId: listing.id, status: "draft", restoredAt: now });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo reactivar el producto." }, { status });
  }
}
