import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { isBillingEnabled } from "@/core/billing/providers/mercadopago/config";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CartItemInput = { productId?: unknown; quantity?: unknown };

export async function POST(request: NextRequest) {
  try {
    if (!isBillingEnabled()) {
      return NextResponse.json({ error: "Los pagos todavía no están habilitados." }, { status: 503 });
    }

    const { user } = await requireUser(request);
    if (!user.email) {
      return NextResponse.json({ error: "Tu cuenta necesita un correo válido para pagar." }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as { items?: CartItemInput[] };
    const requested = Array.isArray(body.items) ? body.items : [];
    const quantities = new Map<string, number>();

    for (const item of requested) {
      const productId = String(item.productId || "").trim();
      if (!productId) continue;
      const quantity = Math.max(1, Math.min(50, Math.floor(Number(item.quantity) || 1)));
      quantities.set(productId, Math.min(50, (quantities.get(productId) ?? 0) + quantity));
    }

    if (quantities.size === 0) {
      return NextResponse.json({ error: "El carrito está vacío." }, { status: 400 });
    }
    if (quantities.size > 20) {
      return NextResponse.json({ error: "El carrito admite hasta 20 productos distintos por compra." }, { status: 400 });
    }

    const productIds = [...quantities.keys()];
    const admin = createAdminSupabase();
    const { data: products, error: productsError } = await admin
      .from("commerce_products")
      .select("id,name,price,currency,product_type,stock,status,owner_type,player_id,studio_id")
      .in("id", productIds);
    if (productsError) throw new Error(productsError.message);

    const mercadoPagoItems: Array<{ title: string; quantity: number; unitPrice: number; currency: string }> = [];
    const orderItems: Array<{
      product_id: string;
      product_name: string;
      product_type: string;
      unit_price: number;
      quantity: number;
      total: number;
    }> = [];

    for (const productId of productIds) {
      const product = products?.find((candidate) => candidate.id === productId);
      const quantity = quantities.get(productId) ?? 0;
      if (!product || product.status !== "published") {
        return NextResponse.json({ error: "Uno de los productos elegidos ya no está disponible." }, { status: 409 });
      }

      const price = Number(product.price);
      if (!Number.isFinite(price) || price < 0) {
        return NextResponse.json({ error: `El precio de “${product.name}” no está configurado correctamente.` }, { status: 409 });
      }
      if (product.stock != null && Number(product.stock) < quantity) {
        return NextResponse.json({ error: `No hay stock suficiente de “${product.name}”.` }, { status: 409 });
      }

      mercadoPagoItems.push({ title: product.name, quantity, unitPrice: price, currency: product.currency });
      orderItems.push({
        product_id: product.id,
        product_name: product.name,
        product_type: product.product_type,
        unit_price: price,
        quantity,
        total: price * quantity,
      });
    }

    const sellerCandidates = new Set(
      products?.map((product) => {
        const ownerId = product.owner_type === "player" ? product.player_id : product.owner_type === "studio" ? product.studio_id : "clouva";
        return `${product.owner_type}:${ownerId}`;
      }) ?? [],
    );
    if (sellerCandidates.size !== 1) {
      return NextResponse.json({ error: "Todos los productos de una orden deben pertenecer al mismo vendedor." }, { status: 400 });
    }

    const currencies = new Set(mercadoPagoItems.map((item) => item.currency));
    if (currencies.size !== 1) {
      return NextResponse.json({ error: "Todos los productos de una orden deben usar la misma moneda." }, { status: 400 });
    }

    const firstProduct = products?.find((product) => product.id === orderItems[0].product_id);
    if (!firstProduct) throw new Error("No pudimos resolver el vendedor de la orden.");

    const currency = mercadoPagoItems[0].currency;
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
        shipping_subtotal: 0,
        total: subtotal,
        currency,
        status: "pending",
        payment_status: "pending",
        fulfillment_status: "pending",
        external_reference: externalReference,
      })
      .select("id,checkout_token")
      .single();
    if (orderError) throw new Error(orderError.message);

    const { error: itemsError } = await admin.from("commerce_order_items").insert(
      orderItems.map((item) => ({ ...item, order_id: order.id })),
    );
    if (itemsError) {
      await admin
        .from("commerce_orders")
        .update({ status: "cancelled", fulfillment_status: "cancelled" })
        .eq("id", order.id);
      throw new Error(itemsError.message);
    }

    await admin.rpc("record_commerce_order_event", {
      p_order_id: order.id,
      p_event_type: "checkout_started",
      p_note: "La orden fue creada y está lista para abrir Mercado Pago.",
      p_dedupe_key: `checkout:${externalReference}:started`,
      p_metadata: { external_reference: externalReference },
    });

    const appBase = (process.env.APP_BASE_URL?.trim() || "https://clouva.com.ar").replace(/\/$/, "");
    const orderUrl = `${appBase}/pedido/${order.id}?source=commerce&token=${encodeURIComponent(order.checkout_token)}`;

    try {
      const preference = await new MercadoPagoProvider().createPreference({
        items: mercadoPagoItems,
        payer: { email: user.email },
        externalReference,
        backUrls: {
          success: `${orderUrl}&return=success`,
          failure: `${orderUrl}&return=failure`,
          pending: `${orderUrl}&return=pending`,
        },
        notificationUrl: `${appBase}/api/webhooks/mercadopago/commerce-orders`,
      });
      const initPoint = typeof preference.init_point === "string" ? preference.init_point : null;
      if (!initPoint) throw new Error("Mercado Pago no devolvió el checkout.");

      return NextResponse.json({
        orderId: order.id,
        checkoutToken: order.checkout_token,
        initPoint,
      });
    } catch (preferenceError) {
      await admin
        .from("commerce_orders")
        .update({ status: "cancelled", fulfillment_status: "cancelled" })
        .eq("id", order.id);
      await admin.rpc("record_commerce_order_event", {
        p_order_id: order.id,
        p_event_type: "checkout_error",
        p_note: preferenceError instanceof Error ? preferenceError.message.slice(0, 500) : "No se pudo crear el checkout.",
        p_dedupe_key: `checkout:${externalReference}:error`,
        p_metadata: { external_reference: externalReference },
      });
      throw preferenceError;
    }
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo iniciar el pago.";
    return NextResponse.json({ error: message }, { status });
  }
}
