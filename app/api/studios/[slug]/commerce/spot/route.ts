import { NextRequest, NextResponse } from "next/server";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const admin = createAdminSupabase();
    const { spot, studio, role } = await requireManagedSpot({ admin, userId: user.id, studioId });

    const [summaryResult, listingsResult, identifiersResult, movementsResult, ordersResult, paymentsResult, locationsResult] = await Promise.all([
      admin.rpc("commerce_spot_financial_summary", { p_spot_id: spot.id }),
      admin
        .from("commerce_products")
        .select("id,spot_id,catalog_product_id,product_type,listing_kind,name,slug,description,price,cost_amount,currency,stock,status,cover_url,gallery,avatar_asset_id,metadata,created_at,updated_at")
        .eq("spot_id", spot.id)
        .order("created_at", { ascending: false }),
      admin
        .from("commerce_product_identifiers")
        .select("id,catalog_product_id,catalog_variant_id,spot_id,identifier_type,value,normalized_value,is_primary,created_at")
        .or(`spot_id.is.null,spot_id.eq.${spot.id}`)
        .order("created_at"),
      admin
        .from("commerce_inventory_movements")
        .select("id,location_id,listing_id,listing_variant_id,movement_type,quantity_delta,stock_after,unit_cost,currency,reference,note,created_at")
        .eq("spot_id", spot.id)
        .order("created_at", { ascending: false })
        .limit(80),
      admin
        .from("commerce_orders")
        .select("id,buyer_id,total,currency,status,payment_status,fulfillment_status,sales_channel,payment_method,customer_name,customer_email,created_at,paid_at")
        .eq("spot_id", spot.id)
        .order("created_at", { ascending: false })
        .limit(80),
      admin
        .from("commerce_payments")
        .select("id,order_id,provider,payment_method,status,gross_amount,fee_amount,net_amount,currency,confirmed_at,created_at")
        .eq("spot_id", spot.id)
        .order("created_at", { ascending: false })
        .limit(80),
      admin
        .from("commerce_inventory_locations")
        .select("id,code,name,status")
        .eq("spot_id", spot.id)
        .order("created_at"),
    ]);

    const listings = listingsResult.data ?? [];
    const listingIds = listings.map((listing) => listing.id);
    const [variantsResult, componentsResult] = listingIds.length
      ? await Promise.all([
        admin
          .from("commerce_product_variants")
          .select("id,product_id,catalog_variant_id,sku,title,size,color,price_override,cost_override,stock,active,low_stock_threshold,metadata")
          .in("product_id", listingIds)
          .order("created_at"),
        admin
          .from("commerce_listing_components")
          .select("id,bundle_listing_id,component_listing_id,component_variant_id,quantity,component_role")
          .in("bundle_listing_id", listingIds)
          .order("created_at"),
      ])
      : [{ data: [], error: null }, { data: [], error: null }];

    const firstError = [
      summaryResult.error,
      listingsResult.error,
      identifiersResult.error,
      movementsResult.error,
      ordersResult.error,
      paymentsResult.error,
      locationsResult.error,
      variantsResult.error,
      componentsResult.error,
    ].find(Boolean);
    if (firstError) throw new Error(firstError.message);

    return NextResponse.json({
      studio: { id: studio.id, name: studio.name, slug: studio.slug },
      role,
      spot,
      summary: summaryResult.data ?? {},
      listings,
      variants: variantsResult.data ?? [],
      components: componentsResult.data ?? [],
      identifiers: identifiersResult.data ?? [],
      movements: movementsResult.data ?? [],
      orders: ordersResult.data ?? [],
      payments: paymentsResult.data ?? [],
      locations: locationsResult.data ?? [],
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cargar El Iglú." }, { status });
  }
}
