import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  buildClouvaBarcodeValue,
  buildClouvaQrUrl,
  buildSpotSku,
  normalizeCommerceIdentifier,
} from "@/lib/commerce/identifiers";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { siteUrl } from "@/lib/site-url";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const body = (await request.json().catch(() => ({}))) as { listingId?: string; variantId?: string | null };
    if (!body.listingId) return NextResponse.json({ error: "Elegí un producto." }, { status: 400 });

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const { data: listing, error: listingError } = await admin
      .from("commerce_products")
      .select("id,spot_id,catalog_product_id,name,slug")
      .eq("id", body.listingId)
      .eq("spot_id", spot.id)
      .maybeSingle();
    if (listingError) throw new Error(listingError.message);
    if (!listing?.catalog_product_id) return NextResponse.json({ error: "El producto todavía no tiene identidad global." }, { status: 409 });

    const { data: variant, error: variantError } = body.variantId
      ? await admin
          .from("commerce_product_variants")
          .select("id,product_id,catalog_variant_id,sku,size,color,title")
          .eq("id", body.variantId)
          .eq("product_id", listing.id)
          .maybeSingle()
      : { data: null, error: null };
    if (variantError) throw new Error(variantError.message);

    const seed = randomUUID().replace(/-/g, "").toUpperCase();
    const sku = variant?.sku || buildSpotSku({
      spotSlug: spot.slug,
      productName: listing.name,
      color: variant?.color,
      size: variant?.size,
      suffix: seed.slice(-4),
    });
    const barcodeId = randomUUID();
    const qrId = randomUUID();
    const barcodeValue = buildClouvaBarcodeValue(seed);
    const qrValue = buildClouvaQrUrl(siteUrl, qrId);
    const rows = [
      {
        catalog_product_id: listing.catalog_product_id,
        catalog_variant_id: variant?.catalog_variant_id ?? null,
        spot_id: spot.id,
        identifier_type: "sku",
        value: sku,
        normalized_value: normalizeCommerceIdentifier(sku),
        is_primary: false,
        created_by: user.id,
      },
      {
        id: barcodeId,
        catalog_product_id: listing.catalog_product_id,
        catalog_variant_id: variant?.catalog_variant_id ?? null,
        spot_id: spot.id,
        identifier_type: "clouva_barcode",
        value: barcodeValue,
        normalized_value: normalizeCommerceIdentifier(barcodeValue),
        is_primary: false,
        created_by: user.id,
      },
      {
        id: qrId,
        catalog_product_id: listing.catalog_product_id,
        catalog_variant_id: variant?.catalog_variant_id ?? null,
        spot_id: spot.id,
        identifier_type: "clouva_qr",
        value: qrValue,
        normalized_value: normalizeCommerceIdentifier(qrValue),
        is_primary: false,
        created_by: user.id,
      },
    ];
    const { data, error } = await admin.from("commerce_product_identifiers").insert(rows)
      .select("id,identifier_type,value,catalog_variant_id,created_at");
    if (error) throw new Error(error.message);

    if (variant && !variant.sku) {
      const { error: skuError } = await admin.from("commerce_product_variants").update({ sku }).eq("id", variant.id);
      if (skuError) throw new Error(skuError.message);
    }
    return NextResponse.json({ identifiers: data ?? [], sku });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron generar los códigos." }, { status });
  }
}
