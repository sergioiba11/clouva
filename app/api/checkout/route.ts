import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { isBillingEnabled } from "@/core/billing/providers/mercadopago/config";
import { requirePhysicalPurchaseEligibility } from "@/lib/server/purchase-eligibility";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutItemInput = {
  id?: unknown;
  quantity?: unknown;
};

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: NextRequest) {
  let createdOrderId: string | null = null;

  try {
    if (!isBillingEnabled()) {
      return NextResponse.json({ error: "Los pagos todavía no están habilitados." }, { status: 503 });
    }

    const { user } = await requireUser(request);
    if (!user.email) return NextResponse.json({ error: "Tu cuenta necesita un correo válido para pagar." }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as { items?: CheckoutItemInput[] };
    const requested = Array.isArray(body.items) ? body.items : [];
    const quantities = new Map<string, number>();
    for (const item of requested) {
      const productId = cleanText(item.id, 80);
      if (!productId) continue;
      const quantity = Math.max(1, Math.min(50, Math.floor(Number(item.quantity) || 1)));
      quantities.set(productId, Math.min(50, (quantities.get(productId) ?? 0) + quantity));
    }

    if (quantities.size === 0) return NextResponse.json({ error: "El carrito está vacío." }, { status: 400 });
    if (quantities.size > 20) return NextResponse.json({ error: "El carrito admite hasta 20 productos distintos por compra." }, { status: 400 });

    const admin = createAdminSupabase();
    const eligibility = await requirePhysicalPurchaseEligibility(admin, user.id);
    const savedAddress = eligibility.defaultAddress!;
    const customer = {
      name: savedAddress.recipient_name,
      phone: savedAddress.recipient_phone || "",
      email: (savedAddress.recipient_email || user.email).toLowerCase(),
      address: [savedAddress.address_line_1, savedAddress.address_line_2, savedAddress.city, savedAddress.province, savedAddress.postal_code, savedAddress.country]
        .filter(Boolean)
        .join(", "),
    };
    if (!customer.name || !customer.address || !validEmail(customer.email)) {
      return NextResponse.json({ error: "Actualizá tu dirección privada antes de comprar.", code: "PURCHASE_ADDRESS_INCOMPLETE", action: "/cuenta/compras" }, { status: 422 });
    }

    const productIds = [...quantities.keys()];
    const { data: products, error: productsError } = await admin
      .from("products")
      .select("id,name,price,stock,active,status")
      .in("id", productIds);
    if (productsError) throw new Error(productsError.message);

    const mercadoPagoItems: Array<{ title: string; quantity: number; unitPrice: number; currency: string }> = [];
    const orderItems: Array<{ product_id: string; qty: number; unit_price_cents: number; quantity: number; unit_price: number; product_name: string }> = [];

    for (const productId of productIds) {
      const product = products?.find((candidate) => candidate.id === productId);
      const quantity = quantities.get(productId) ?? 0;
      if (!product || !product.active || product.status !== "activo") return NextResponse.json({ error: "Uno de los productos ya no está disponible." }, { status: 409 });

      const price = Number(product.price);
      const stock = Number(product.stock);
      if (!Number.isFinite(price) || price <= 0) return NextResponse.json({ error: `El precio de “${product.name}” no está configurado correctamente.` }, { status: 409 });
      if (!Number.isFinite(stock) || stock < quantity) return NextResponse.json({ error: `No hay stock suficiente de “${product.name}”.` }, { status: 409 });

      const unitPriceCents = Math.round(price * 100);
      mercadoPagoItems.push({ title: product.name, quantity, unitPrice: price, currency: "ARS" });
      orderItems.push({ product_id: product.id, qty: quantity, unit_price_cents: unitPriceCents, quantity, unit_price: price, product_name: product.name });
    }

    const totalCents = orderItems.reduce((total, item) => total + item.unit_price_cents * item.qty, 0);
    const total = totalCents / 100;
    const externalReference = randomUUID();

    const { data: existingCustomer, error: customerReadError } = await admin.from("customers").select("id").eq("email", customer.email).maybeSingle();
    if (customerReadError) throw new Error(customerReadError.message);
    let customerId = existingCustomer?.id ?? null;
    if (!customerId) {
      const { data: insertedCustomer, error: customerInsertError } = await admin.from("customers").insert({ email: customer.email }).select("id").single();
      if (customerInsertError) throw new Error(customerInsertError.message);
      customerId = insertedCustomer.id;
    }

    const { data: order, error: orderError } = await admin
      .from("orders")
      .insert({
        customer_id: customerId,
        customer_name: customer.name,
        customer_phone: customer.phone || null,
        customer_email: customer.email,
        customer_address: customer.address,
        address: customer.address,
        total,
        total_cents: totalCents,
        currency: "ARS",
        payment_method: "mercadopago",
        payment_status: "pendiente",
        shipping_status: "pendiente",
        status: "pendiente",
        external_reference: externalReference,
      })
      .select("id,checkout_token")
      .single();
    if (orderError) throw new Error(orderError.message);
    createdOrderId = order.id;

    const { error: orderItemsError } = await admin.from("order_items").insert(orderItems.map((item) => ({ ...item, order_id: order.id })));
    if (orderItemsError) throw new Error(orderItemsError.message);

    await admin.from("order_status_history").insert({ order_id: order.id, status: "pendiente_pago", note: "Checkout de Mercado Pago creado." });
    const appBase = (process.env.APP_BASE_URL?.trim() || "https://clouva.com.ar").replace(/\/$/, "");
    const orderUrl = `${appBase}/pedido/${order.id}?token=${encodeURIComponent(order.checkout_token)}`;

    const preference = await new MercadoPagoProvider().createPreference({
      items: mercadoPagoItems,
      payer: { name: customer.name, email: customer.email },
      externalReference,
      backUrls: { success: `${orderUrl}&return=success`, failure: `${orderUrl}&return=failure`, pending: `${orderUrl}&return=pending` },
      notificationUrl: `${appBase}/api/webhooks/mercadopago/store-orders`,
    });
    const initPoint = typeof preference.init_point === "string" ? preference.init_point : null;
    if (!initPoint) throw new Error("Mercado Pago no devolvió el checkout.");
    return NextResponse.json({ orderId: order.id, checkoutToken: order.checkout_token, initPoint });
  } catch (error) {
    const admin = createAdminSupabase();
    if (createdOrderId) {
      await admin.from("orders").update({ payment_status: "cancelado", shipping_status: "cancelado", status: "cancelado" }).eq("id", createdOrderId);
      await admin.from("order_status_history").insert({
        order_id: createdOrderId,
        status: "checkout_error",
        note: error instanceof Error ? error.message.slice(0, 500) : "No se pudo crear el checkout.",
      });
    }

    const typed = error as Error & { status?: number; code?: string };
    const message = error instanceof Error ? error.message : "No se pudo iniciar el pago.";
    console.error("store_checkout_failed", { orderId: createdOrderId, message });
    return NextResponse.json(
      { error: message, ...(typed.code ? { code: typed.code, action: "/cuenta/compras" } : {}) },
      { status: typed.status ?? (isAuthError(error) ? 401 : 500) },
    );
  }
}
