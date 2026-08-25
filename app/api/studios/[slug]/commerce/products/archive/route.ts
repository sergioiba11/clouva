import { NextRequest, NextResponse } from "next/server";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ArchiveBody = { listingId?: unknown };

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const body = (await request.json().catch(() => ({}))) as ArchiveBody;
    const listingId = typeof body.listingId === "string" ? body.listingId.trim() : "";
    if (!listingId) return NextResponse.json({ error: "Falta el producto a eliminar." }, { status: 400 });

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });

    const { data: listing, error: listingError } = await admin
      .from("commerce_products")
      .select("id,spot_id,catalog_product_id,status,name")
      .eq("id", listingId)
      .eq("spot_id", spot.id)
      .maybeSingle();
    if (listingError) throw new Error(listingError.message);
    if (!listing) return NextResponse.json({ error: "Ese producto no pertenece a este MI SPOT." }, { status: 404 });

    const now = new Date().toISOString();
    const { error: productError } = await admin
      .from("commerce_products")
      .update({ status: "archived", updated_at: now })
      .eq("id", listing.id)
      .eq("spot_id", spot.id);
    if (productError) throw new Error(productError.message);

    const { error: variantError } = await admin
      .from("commerce_product_variants")
      .update({ active: false })
      .eq("product_id", listing.id);
    if (variantError) throw new Error(variantError.message);

    if (listing.catalog_product_id) {
      const { data: activeIdentifiers, error: identifiersError } = await admin
        .from("commerce_product_identifiers")
        .select("id")
        .eq("catalog_product_id", listing.catalog_product_id)
        .eq("spot_id", spot.id)
        .eq("status", "active");
      if (identifiersError) throw new Error(identifiersError.message);
      const identifierIds = (activeIdentifiers ?? []).map((row) => row.id);
      if (identifierIds.length) {
        const { error: disableError } = await admin
          .from("commerce_product_identifiers")
          .update({ status: "disabled", disabled_at: now, disabled_by: user.id, updated_at: now })
          .in("id", identifierIds);
        if (disableError) throw new Error(disableError.message);
      }
    }

    const { error: componentError } = await admin
      .from("commerce_listing_components")
      .delete()
      .or(`bundle_listing_id.eq.${listing.id},component_listing_id.eq.${listing.id}`);
    if (componentError) throw new Error(componentError.message);

    return NextResponse.json({ ok: true, listingId: listing.id, archivedAt: now });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo eliminar el producto." }, { status });
  }
}
