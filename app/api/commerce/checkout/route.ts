import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { isBillingEnabled } from "@/core/billing/providers/mercadopago/config";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CartItemInput = { productId?: unknown; quantity?: unknown };

// Same shape as /api/studios/[slug]/service-orders on purpose: one seller
// per order (no multi-vendor cart/split-payment in this MVP -- the plan
// itself defers that), price/stock always recomputed server-side from
// commerce_products, never trusted from the client.
export async function POST(request: NextRequest) {
  try {
    if (!isBillingEnabled()) return NextResponse.json({ error: "Los pagos todavía no están habilitados." }, { status: 503 });
    const { user } = await requireUser(request);
    if (!user.email) return NextResponse.json({ error: "Tu cuenta necesita un correo válido para pagar." }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as { items?: CartItemInput[] };
    const requested = Array.isArray(body.items) ? body.items : [];
    if (requested.length === 0) return NextResponse.json({ error: "El carrito está vacío." }, { status: 400 });

    const productIds = [...new Set(requested.map((item) => String(item.productId || "")).filter(Boolean))].slice(0, 20);
    if (productIds.length === 0) return NextResponse.json({ error: "El carrito está vacío." }, { status: 400 });

    const admin = createAdminSupabase();
    const { data: products, error: productsError } = await admin
      .from("commerce_products")
      .select("id,name,price,currency,product_type,stock,status,owner_type,player_id,studio_id")
      .in("id", productIds);
    if (productsError) throw new Error(productsError.message);

    const items: Array<{ title: string; quantity: number; unitPrice: number; currency: string }> = [];
    const orderItems: Array<{ product_id: string; product_name: string; product_type: string; unit_price: number; quantity: number; total: number }> = [];
    for (const requestedItem of requested) {
      const productId = String(requestedItem.productId || "");
      const quantity = Math.max(1, Math.min(50, Math.floor(Number(requestedItem.quantity) || 0)));
      const product = products?.find((p) => p.id === productId);
      if (!product || product.status !== "published") continue;
      if (product.stock != null && product.stock < quantity) {
        return NextResponse.json({ error: `No hay stock suficiente de "${product.name}".` }, { status: 409 });
      }
      items.push({ title: product.name, quantity, unitPrice: Number(product.price), currency: product.currency });
      orderItems.push({
        product_id: product.id,
        product_name: product.name,
        product_type: product.product_type,
        unit_price: Number(product.price),
        quantity,
        total: Number(product.price) * quantity,
      });
    }
    if (items.length === 0) return NextResponse.json({ error: "Ninguno de los productos elegidos está disponible." }, { status: 400 });

    const sellerCandidates = new Set<string>();
    for (const item of orderItems) {
      const product = products?.find((p) => p.id === item.product_id);
      if (!product) continue;
      sellerCandidates.add(`${product.owner_type}:${product.owner_type === "player" ? product.player_id : product.studio_id}`);
    }
    if (sellerCandidates.size > 1) {
      return NextResponse.json({ error: "Todos los productos de una orden deben ser del mismo vendedor por ahora." }, { status: 400 });
    }
    const firstProduct = products?.find((p) => p.id === orderItems[0].product_id);
    if (!firstProduct) throw new Error("No pudimos resolver el vendedor de la orden.");

    const currency = items[0].currency;
    const subtotal = orderItems.reduce((sum, item) => sum + item.total, 0);
    const externalReference = randomUUID();

    const { data: order, error: orderError } = await admin
      .from("commerce_orders")
      .insert({
        buyer_id: user.id,
        seller_type: firstProduct.owner_type,
        seller_player_id: firstProduct.owner_type === "player" ? firstProduct.player_id : null,
        seller_studio_id: firstProduct.owner_type === "studio" ? firstProduct.studio_id : null,
        subtotal,
        total: subtotal,
        currency,
        status: "pending",
        payment_status: "pending",
        external_reference: externalReference,
      })
      .select("id")
      .single();
    if (orderError) throw new Error(orderError.message);

    const { error: itemsError } = await admin.from("commerce_order_items").insert(
      orderItems.map((item) => ({ ...item, order_id: order.id })),
    );
    if (itemsError) {
      await admin.from("commerce_orders").update({ status: "cancelled" }).eq("id", order.id);
      throw new Error(itemsError.message);
    }

    const appBase = process.env.APP_BASE_URL?.trim() || "https://clouva.com.ar";
    try {
      const preference = await new MercadoPagoProvider().createPreference({
        items,
        externalReference,
        backUrls: {
          success: `${appBase}/pedido/${order.id}?status=success`,
          failure: `${appBase}/pedido/${order.id}?status=failure`,
          pending: `${appBase}/pedido/${order.id}?status=pending`,
        },
        notificationUrl: `${appBase}/api/webhooks/mercadopago/commerce-orders`,
      });
      const initPoint = typeof preference.init_point === "string" ? preference.init_point : null;
      if (!initPoint) throw new Error("Mercado Pago no devolvió el checkout.");
      return NextResponse.json({ orderId: order.id, initPoint });
    } catch (preferenceError) {
      await admin.from("commerce_orders").update({ status: "cancelled" }).eq("id", order.id);
      throw preferenceError;
    }
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo iniciar el pago.";
    return NextResponse.json({ error: message }, { status });
  }
}
