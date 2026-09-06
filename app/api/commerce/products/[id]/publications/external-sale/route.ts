import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { latestOrRefreshSpotFxRate } from "@/lib/server/commerce-fx";
import { requireSpotAccess } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXTERNAL_CHANNELS = new Set(["facebook_marketplace", "facebook_group", "facebook_page", "external"]);
const PAYMENT_METHODS = new Set(["cash", "transfer", "debit_card", "credit_card", "other"]);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { id: productId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      publicationId?: string;
      variantId?: string | null;
      quantity?: number;
      unitPrice?: number;
      paymentMethod?: string;
      feeAmount?: number;
      customerName?: string;
      customerEmail?: string;
      buyerId?: string | null;
      externalReference?: string;
      idempotencyKey?: string;
    };
    if (!body.publicationId) return NextResponse.json({ error: "Elegí la publicación donde se concretó la venta." }, { status: 400 });

    const admin = createAdminSupabase();
    const { data: product, error: productError } = await admin
      .from("commerce_products")
      .select("id,spot_id,price,currency,product_type")
      .eq("id", productId)
      .maybeSingle();
    if (productError) throw new Error(productError.message);
    if (!product?.spot_id) return NextResponse.json({ error: "El producto no pertenece a un negocio comercial." }, { status: 404 });

    const { spot } = await requireSpotAccess({ admin, userId: user.id, spotId: product.spot_id, capability: "sales" });
    const { data: publication, error: publicationError } = await admin
      .from("commerce_product_publications")
      .select("id,product_id,target_type,channel,status")
      .eq("id", body.publicationId)
      .eq("product_id", productId)
      .eq("target_type", "marketplace")
      .maybeSingle();
    if (publicationError) throw new Error(publicationError.message);
    if (!publication || !EXTERNAL_CHANNELS.has(publication.channel)) {
      return NextResponse.json({ error: "La publicación seleccionada no es un canal de venta externo." }, { status: 400 });
    }

    const quantity = Math.max(1, Math.floor(Number(body.quantity) || 1));
    const unitPrice = Number.isFinite(body.unitPrice) ? Number(body.unitPrice) : Number(product.price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return NextResponse.json({ error: "Precio final inválido." }, { status: 400 });
    const feeAmount = Number.isFinite(body.feeAmount) ? Math.max(0, Number(body.feeAmount)) : 0;
    const paymentMethod = PAYMENT_METHODS.has(String(body.paymentMethod)) ? String(body.paymentMethod) : "cash";

    const fxRate = await latestOrRefreshSpotFxRate({ admin, spot });
    const idempotencyKey = body.idempotencyKey?.trim() || `external-sale:${spot.id}:${productId}:${randomUUID()}`;
    const { data, error } = await admin.rpc("complete_commerce_external_sale", {
      p_spot_id: spot.id,
      p_listing_id: productId,
      p_variant_id: body.variantId || null,
      p_quantity: quantity,
      p_unit_price: unitPrice,
      p_sales_channel: publication.channel,
      p_publication_id: publication.id,
      p_payment_method: paymentMethod,
      p_customer_name: body.customerName?.trim() || null,
      p_customer_email: body.customerEmail?.trim() || null,
      p_buyer_id: body.buyerId || null,
      p_fx_rate_id: fxRate.id,
      p_fee_amount: feeAmount,
      p_external_reference: body.externalReference?.trim() || null,
      p_actor_id: user.id,
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ sale: data }, { status: 201 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo registrar la venta externa." }, { status });
  }
}
