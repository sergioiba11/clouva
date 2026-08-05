import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { isBillingEnabled } from "@/core/billing/providers/mercadopago/config";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CartItemInput = { productId?: unknown; variantId?: unknown; quantity?: unknown };
type RequestedLine = { productId: string; variantId: string | null; quantity: number };

function lineKey(productId: string, variantId: string | null) {
  return `${productId}:${variantId ?? "base"}`;
}

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
    const lines = new Map<string, RequestedLine>();

    for (const item of requested) {
      const productId = String(item.productId || "").trim();
      const variantId = String(item.variantId || "").trim() || null;
      if (!productId) continue;
      const quantity = Math.max(1, Math.min(50, Math.floor(Number(item.quantity) || 1)));
      const key = lineKey(productId, variantId);
      const existing = lines.get(key);
      lines.set(key, {
        productId,
        variantId,
        quantity: Math.min(50, (existing?.quantity ?? 0) + quantity),
      });
    }

    if (lines.size === 0) {
      return NextResponse.json({ error: "El carrito está vacío." }, { status: 400 });
    }
    if (lines.size > 20) {
      return NextResponse.json({ error: "El carrito admite hasta 20 variantes distintas por compra." }, { status: 400 });
    }

    const requestedLines = [...lines.values()];
    const productIds = [...new Set(requestedLines.map((line) => line.productId))];
    const admin = createAdminSupabase();
    const [{ data: products, error: productsError }, { data: variants, error: variantsError }] = await Promise.all([
      admin
        .from("commerce_products")
        .select("id,name,price,currency,product_type,stock,status,owner_type,player_id,studio_id")
        .in("id", productIds),
      admin
        .from("commerce_product_variants")
        .select("id,product_id,sku,title,size,color,price_override,stock,active")
        .in("product_id", productIds),
    ]);
    if (productsError || variantsError) throw new Error(productsError?.message || variantsError?.message);

    const mercadoPagoItems: Array<{ title: string; quantity: number; unitPrice: number; currency: string }> = [];
    const orderItems: Array<{
      product_id: string;
      variant_id: string | null;
      sku_snapshot: string | null;
      variant_snapshot: Record<string, unknown>;
      product_name: string;
      product_type: string;
      unit_price: number;
      quantity: number;
      total: number;
    }> = [];

    for (const requestedLine of requestedLines) {
      const product = products?.find((candidate) => candidate.id === requestedLine.productId);
      const productVariants = (variants ?? []).filter((candidate) => candidate.product_id === requestedLine.productId);
      if (!product || product.status !== "published") {
        return NextResponse.json({ error: "Uno de los productos elegidos ya no está disponible." }, { status: 409 });
      }

      let selectedVariant = null as (typeof productVariants)[number] | null;
      if (requestedLine.variantId) {
        selectedVariant = productVariants.find((candidate) => candidate.id === requestedLine.variantId) ?? null;
        if (!selectedVariant || !selectedVariant.active) {
          return NextResponse.json({ error: `La variante elegida de “${product.name}” ya no está disponible.` }, { status: 409 });
        }
      } else if (productVariants.length > 0) {
        return NextResponse.json({ error: `Elegí talle y color para “${product.name}”.` }, { status: 400 });
      }

      const price = Number(selectedVariant?.price_override ?? product.price);
      const availableStock = selectedVariant ? Number(selectedVariant.stock) : product.stock == null ? null : Number(product.stock);
      if (!Number.isFinite(price) || price < 0) {
        return NextResponse.json({ error: `El precio de “${product.name}” no está configurado correctamente.` }, { status: 409 });
      }
      if (availableStock != null && availableStock < requestedLine.quantity) {
        return NextResponse.json({ error: `No hay stock suficiente de “${product.name}”.` }, { status: 409 });
      }

      const variantLabel = selectedVariant
        ? [selectedVariant.title, selectedVariant.size, selectedVariant.color].filter(Boolean).join(" · ")
        : "";
      const title = variantLabel ? `${product.name} — ${variantLabel}` : product.name;
      const variantSnapshot = selectedVariant
        ? {
            id: selectedVariant.id,
            sku: selectedVariant.sku,
            title: selectedVariant.title,
            size: selectedVariant.size,
            color: selectedVariant.color,
          }
        : {};

      mercadoPagoItems.push({
        title,
        quantity: requestedLine.quantity,
        unitPrice: price,
        currency: product.currency,
      });
      orderItems.push({
        product_id: product.id,
        variant_id: selectedVariant?.id ?? null,
        sku_snapshot: selectedVariant?.sku ?? null,
        variant_snapshot: variantSnapshot,
        product_name: product.name,
        product_type: product.product_type,
        unit_price: price,
        quantity: requestedLine.quantity,
        total: price * requestedLine.quantity,
      });
    }

    const selectedProducts = productIds
      .map((productId) => products?.find((product) => product.id === productId))
      .filter((product): product is NonNullable<typeof product> => Boolean(product));
    const sellerCandidates = new Set(
      selectedProducts.map((product) => {
        const ownerId =
          product.owner_type === "player"
            ? product.player_id
            : product.owner_type === "studio"
              ? product.studio_id
              : "clouva";
        return `${product.owner_type}:${ownerId}`;
      }),
    );
    if (sellerCandidates.size !== 1) {
      return NextResponse.json({ error: "Todos los productos de una orden deben pertenecer al mismo vendedor." }, { status: 400 });
    }

    const currencies = new Set(mercadoPagoItems.map((item) => item.currency));
    if (currencies.size !== 1) {
      return NextResponse.json({ error: "Todos los productos de una orden deben usar la misma moneda." }, { status: 400 });
    }

    const firstProduct = selectedProducts[0];
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
