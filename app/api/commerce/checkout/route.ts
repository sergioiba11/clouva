import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { isBillingEnabled } from "@/core/billing/providers/mercadopago/config";
import {
  quoteCommerceShipping,
  type CommerceShippingAddress,
  type CommerceShippingMethod,
} from "@/core/commerce/shipping/service";
import { requirePhysicalPurchaseEligibility } from "@/lib/server/purchase-eligibility";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CartItemInput = { productId?: unknown; variantId?: unknown; quantity?: unknown };
type RequestedLine = { productId: string; variantId: string | null; quantity: number };
type ShippingInput = {
  methodId?: unknown;
  recipientName?: unknown;
  recipientPhone?: unknown;
  recipientEmail?: unknown;
  addressLine1?: unknown;
  addressLine2?: unknown;
  city?: unknown;
  province?: unknown;
  postalCode?: unknown;
  country?: unknown;
};

function lineKey(productId: string, variantId: string | null) {
  return `${productId}:${variantId ?? "base"}`;
}

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function shippingMethodMatchesSeller(
  method: CommerceShippingMethod,
  seller: { owner_type: string; player_id: string | null; studio_id: string | null },
) {
  if (method.owner_type !== seller.owner_type) return false;
  if (method.owner_type === "player") return method.player_id === seller.player_id;
  if (method.owner_type === "studio") return method.studio_id === seller.studio_id;
  return method.player_id == null && method.studio_id == null;
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

    const body = (await request.json().catch(() => ({}))) as {
      items?: CartItemInput[];
      shipping?: ShippingInput;
    };
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
    const [{ data: products, error: productsError }, { data: variants, error: variantsError }, { data: bundleComponents, error: bundleComponentsError }] = await Promise.all([
      admin
        .from("commerce_products")
        .select("id,name,price,currency,product_type,listing_kind,stock,status,owner_type,player_id,studio_id,spot_id,metadata")
        .in("id", productIds),
      admin
        .from("commerce_product_variants")
        .select("id,product_id,sku,title,size,color,price_override,stock,active,weight_grams")
        .in("product_id", productIds),
      admin
        .from("commerce_listing_components")
        .select("bundle_listing_id,component_role")
        .in("bundle_listing_id", productIds),
    ]);
    if (productsError || variantsError || bundleComponentsError) throw new Error(productsError?.message || variantsError?.message || bundleComponentsError?.message);

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
      metadata: Record<string, unknown>;
    }> = [];

    for (const requestedLine of requestedLines) {
      const product = products?.find((candidate) => candidate.id === requestedLine.productId);
      const productVariants = (variants ?? []).filter((candidate) => candidate.product_id === requestedLine.productId);
      if (!product || product.status !== "published") {
        return NextResponse.json({ error: "Uno de los productos elegidos ya no está disponible." }, { status: 409 });
      }
      if (product.metadata?.availability === "coming_soon") {
        return NextResponse.json({ error: `“${product.name}” figura como PRÓXIMAMENTE y todavía no admite compras.` }, { status: 409 });
      }
      if (product.product_type === "bundle") {
        const configured = (bundleComponents ?? []).filter((component) => component.bundle_listing_id === product.id);
        if (!configured.some((component) => component.component_role === "physical") || !configured.some((component) => component.component_role === "digital")) {
          return NextResponse.json({ error: `El combo “${product.name}” todavía no tiene conectados sus componentes físico y digital.` }, { status: 409 });
        }
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
        ? { id: selectedVariant.id, sku: selectedVariant.sku, title: selectedVariant.title, size: selectedVariant.size, color: selectedVariant.color }
        : {};

      mercadoPagoItems.push({ title, quantity: requestedLine.quantity, unitPrice: price, currency: product.currency });
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
        metadata: selectedVariant?.weight_grams == null ? {} : { weight_grams: selectedVariant.weight_grams },
      });
    }

    const selectedProducts = productIds
      .map((productId) => products?.find((product) => product.id === productId))
      .filter((product): product is NonNullable<typeof product> => Boolean(product));
    const sellerCandidates = new Set(selectedProducts.map((product) => {
      const ownerId = product.owner_type === "player" ? product.player_id : product.owner_type === "studio" ? product.studio_id : "clouva";
      return `${product.owner_type}:${ownerId}`;
    }));
    if (sellerCandidates.size !== 1) return NextResponse.json({ error: "Todos los productos de una orden deben pertenecer al mismo vendedor." }, { status: 400 });
    const spotCandidates = new Set(selectedProducts.map((product) => product.spot_id ?? "none"));
    if (spotCandidates.size !== 1) return NextResponse.json({ error: "Todos los productos de una orden deben pertenecer al mismo Spot." }, { status: 400 });

    const currencies = new Set(mercadoPagoItems.map((item) => item.currency));
    if (currencies.size !== 1) return NextResponse.json({ error: "Todos los productos de una orden deben usar la misma moneda." }, { status: 400 });

    const firstProduct = selectedProducts[0];
    if (!firstProduct) throw new Error("No pudimos resolver el vendedor de la orden.");

    const currency = mercadoPagoItems[0].currency;
    const subtotal = orderItems.reduce((sum, item) => sum + item.total, 0);
    const hasPhysical = selectedProducts.some((item) => item.product_type === "physical" || item.listing_kind === "combo");
    let shippingSubtotal = 0;
    let shipment: null | {
      method: CommerceShippingMethod;
      address: CommerceShippingAddress;
      carrier: string | null;
      quoteMetadata: Record<string, unknown>;
    } = null;

    if (hasPhysical) {
      const eligibility = await requirePhysicalPurchaseEligibility(admin, user.id);
      const savedAddress = eligibility.defaultAddress!;
      const shipping = body.shipping ?? {};
      const methodId = cleanText(shipping.methodId, 80);
      if (!methodId) return NextResponse.json({ error: "Elegí un método de entrega." }, { status: 400 });

      const { data: methodRow, error: methodError } = await admin
        .from("commerce_shipping_methods")
        .select("id,owner_type,player_id,studio_id,code,name,description,delivery_method,carrier,pricing_type,flat_price,currency,adapter_key,config")
        .eq("id", methodId)
        .eq("active", true)
        .maybeSingle();
      if (methodError) throw new Error(methodError.message);
      if (!methodRow) return NextResponse.json({ error: "El método de entrega ya no está disponible." }, { status: 409 });

      const method = methodRow as CommerceShippingMethod;
      if (!shippingMethodMatchesSeller(method, firstProduct)) return NextResponse.json({ error: "El método de entrega no pertenece al vendedor de esta orden." }, { status: 400 });
      if (method.currency !== currency) return NextResponse.json({ error: "El método de entrega usa una moneda distinta a la orden." }, { status: 400 });

      // Physical checkout always snapshots the user's private saved address.
      // Player.location is deliberately not referenced here.
      const address: CommerceShippingAddress = {
        recipientName: savedAddress.recipient_name,
        recipientPhone: savedAddress.recipient_phone || "",
        recipientEmail: savedAddress.recipient_email || user.email.toLowerCase(),
        addressLine1: savedAddress.address_line_1,
        addressLine2: savedAddress.address_line_2 || "",
        city: savedAddress.city,
        province: savedAddress.province,
        postalCode: savedAddress.postal_code,
        country: savedAddress.country,
      };

      if (!address.recipientName || !address.recipientPhone || !validEmail(address.recipientEmail)) {
        return NextResponse.json({ error: "Actualizá el destinatario, teléfono y email de tu dirección privada.", code: "PURCHASE_ADDRESS_INCOMPLETE" }, { status: 422 });
      }
      if (method.delivery_method === "shipping" && (!address.addressLine1 || !address.city || !address.province || !address.postalCode || !address.country)) {
        return NextResponse.json({ error: "Tu dirección privada de entrega está incompleta.", code: "PURCHASE_ADDRESS_INCOMPLETE" }, { status: 422 });
      }

      const shippableItems = orderItems.filter((item) => item.product_type === "physical" || item.product_type === "bundle");
      const knownWeights = shippableItems.map((item) => Number(item.metadata.weight_grams)).filter((weight) => Number.isFinite(weight) && weight >= 0);
      const totalWeightGrams = knownWeights.length === shippableItems.length
        ? shippableItems.reduce((sum, item) => sum + Number(item.metadata.weight_grams) * item.quantity, 0)
        : null;
      const quote = await quoteCommerceShipping(method, address, {
        subtotal,
        itemCount: shippableItems.reduce((sum, item) => sum + item.quantity, 0),
        totalWeightGrams,
      });
      shippingSubtotal = quote.price;
      shipment = {
        method,
        address,
        carrier: quote.carrier,
        quoteMetadata: { service_code: quote.serviceCode, ...(quote.metadata ?? {}) },
      };

      if (shippingSubtotal > 0) mercadoPagoItems.push({ title: `Entrega — ${method.name}`, quantity: 1, unitPrice: shippingSubtotal, currency });
    }

    const total = subtotal + shippingSubtotal;
    const externalReference = randomUUID();

    const { data: order, error: orderError } = await admin
      .from("commerce_orders")
      .insert({
        buyer_id: user.id,
        seller_type: firstProduct.owner_type,
        seller_player_id: firstProduct.owner_type === "player" ? firstProduct.player_id : null,
        seller_studio_id: firstProduct.owner_type === "studio" ? firstProduct.studio_id : null,
        spot_id: firstProduct.spot_id ?? null,
        subtotal,
        shipping_subtotal: shippingSubtotal,
        total,
        currency,
        status: "pending",
        payment_status: "pending",
        fulfillment_status: "pending",
        external_reference: externalReference,
        sales_channel: firstProduct.spot_id ? "online" : "marketplace",
        created_by: user.id,
      })
      .select("id,checkout_token")
      .single();
    if (orderError) throw new Error(orderError.message);

    const { error: itemsError } = await admin.from("commerce_order_items").insert(orderItems.map((item) => ({ ...item, order_id: order.id })));
    if (itemsError) {
      await admin.from("commerce_orders").update({ status: "cancelled", fulfillment_status: "cancelled" }).eq("id", order.id);
      throw new Error(itemsError.message);
    }

    if (shipment) {
      const { method, address, carrier, quoteMetadata } = shipment;
      const { error: shipmentError } = await admin.from("commerce_shipments").insert({
        order_id: order.id,
        shipment_group: "primary",
        recipient_name: address.recipientName,
        recipient_phone: address.recipientPhone,
        recipient_email: address.recipientEmail,
        address_line_1: method.delivery_method === "shipping" ? address.addressLine1 : null,
        address_line_2: method.delivery_method === "shipping" ? address.addressLine2 || null : null,
        city: method.delivery_method === "shipping" ? address.city : null,
        province: method.delivery_method === "shipping" ? address.province : null,
        postal_code: method.delivery_method === "shipping" ? address.postalCode : null,
        country: address.country,
        delivery_method: method.delivery_method,
        carrier,
        shipping_cost: shippingSubtotal,
        status: "pending",
        shipping_method_id: method.id,
        shipping_method_snapshot: {
          id: method.id,
          code: method.code,
          name: method.name,
          delivery_method: method.delivery_method,
          carrier: method.carrier,
          pricing_type: method.pricing_type,
          currency: method.currency,
        },
        metadata: { quote: quoteMetadata },
      });
      if (shipmentError) {
        await admin.from("commerce_orders").update({ status: "cancelled", fulfillment_status: "cancelled" }).eq("id", order.id);
        throw new Error(shipmentError.message);
      }
    }

    await admin.rpc("record_commerce_order_event", {
      p_order_id: order.id,
      p_event_type: "checkout_started",
      p_note: "La orden fue creada y está lista para abrir Mercado Pago.",
      p_dedupe_key: `checkout:${externalReference}:started`,
      p_metadata: { external_reference: externalReference, shipping_subtotal: shippingSubtotal, shipping_method_id: shipment?.method.id ?? null },
    });

    const appBase = (process.env.APP_BASE_URL?.trim() || "https://clouva.com.ar").replace(/\/$/, "");
    const orderUrl = `${appBase}/pedido/${order.id}?source=commerce&token=${encodeURIComponent(order.checkout_token)}`;

    try {
      const preference = await new MercadoPagoProvider().createPreference({
        items: mercadoPagoItems,
        payer: { email: user.email },
        externalReference,
        backUrls: { success: `${orderUrl}&return=success`, failure: `${orderUrl}&return=failure`, pending: `${orderUrl}&return=pending` },
        notificationUrl: `${appBase}/api/webhooks/mercadopago/commerce-orders`,
      });
      const initPoint = typeof preference.init_point === "string" ? preference.init_point : null;
      if (!initPoint) throw new Error("Mercado Pago no devolvió el checkout.");
      return NextResponse.json({ orderId: order.id, checkoutToken: order.checkout_token, initPoint });
    } catch (preferenceError) {
      await admin.from("commerce_orders").update({ status: "cancelled", fulfillment_status: "cancelled" }).eq("id", order.id);
      await admin.from("commerce_shipments").update({ status: "cancelled" }).eq("order_id", order.id);
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
    const typed = error as Error & { status?: number; code?: string };
    const status = typed.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo iniciar el pago.";
    return NextResponse.json({ error: message, ...(typed.code ? { code: typed.code, action: "/cuenta/compras" } : {}) }, { status });
  }
}
