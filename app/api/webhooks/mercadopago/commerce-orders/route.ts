import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { getMercadoPagoConfig } from "@/core/billing/providers/mercadopago/config";
import { verifyMercadoPagoSignature } from "@/core/billing/providers/mercadopago/signature";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function text(value: unknown) {
  return value == null ? "" : String(value);
}

function normalizePaymentStatus(value: unknown) {
  return text(value).trim().toLowerCase();
}

function validProviderDate(value: unknown) {
  const raw = text(value);
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : new Date().toISOString();
}

async function recordEvent(
  admin: ReturnType<typeof createAdminSupabase>,
  input: {
    orderId: string;
    eventType: string;
    note: string;
    dedupeKey: string;
    metadata?: Record<string, unknown>;
  },
) {
  const { error } = await admin.rpc("record_commerce_order_event", {
    p_order_id: input.orderId,
    p_event_type: input.eventType,
    p_note: input.note,
    p_dedupe_key: input.dedupeKey,
    p_metadata: input.metadata ?? {},
  });
  if (error) throw new Error(error.message);
}

async function deliverPurchasedItems(
  admin: ReturnType<typeof createAdminSupabase>,
  orderId: string,
  paymentId: string,
) {
  const { data: items, error: itemsError } = await admin
    .from("commerce_order_items")
    .select("id,product_type")
    .eq("order_id", orderId)
    .neq("product_type", "physical");
  if (itemsError) throw new Error(itemsError.message);

  let delivered = 0;
  const failures: Array<{ orderItemId: string; message: string }> = [];

  for (const item of items ?? []) {
    const { data, error } = await admin.rpc("deliver_commerce_order_item", {
      p_order_item_id: item.id,
    });

    if (!error) {
      const result = data as { processed?: boolean; duplicate?: boolean } | null;
      if (result?.processed || result?.duplicate) delivered += 1;
      continue;
    }

    const message = error.message.slice(0, 500);
    failures.push({ orderItemId: item.id, message });

    await admin
      .from("commerce_order_items")
      .update({
        delivery_status: "failed",
        delivery_claimed_at: null,
        delivery_error: message,
      })
      .eq("id", item.id)
      .neq("delivery_status", "delivered");

    await recordEvent(admin, {
      orderId,
      eventType: "item_delivery_failed",
      note: "El pago quedó confirmado, pero un item digital requiere reintento de entrega.",
      dedupeKey: `delivery:${paymentId}:${item.id}:failed`,
      metadata: { payment_id: paymentId, order_item_id: item.id, error: message },
    });
  }

  return { delivered, failures };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      id?: string | number;
      type?: string;
      topic?: string;
      data?: { id?: string | number };
    };

    const topic = normalizePaymentStatus(body.type || body.topic);
    const resourceId = text(
      body.data?.id ||
        request.nextUrl.searchParams.get("data.id") ||
        request.nextUrl.searchParams.get("id"),
    );

    if (!topic || !resourceId) {
      return NextResponse.json({ error: "Notificación sin tipo o recurso." }, { status: 400 });
    }
    if (topic !== "payment") {
      return NextResponse.json({ received: true, ignored: true, topic });
    }

    const requestId = request.headers.get("x-request-id") || "";
    const signatureHeader = request.headers.get("x-signature") || "";
    const config = getMercadoPagoConfig("production");
    const validSignature = verifyMercadoPagoSignature({
      xSignature: signatureHeader,
      xRequestId: requestId,
      dataId: resourceId,
      secret: config.webhookSecret,
    });
    if (!validSignature) {
      return NextResponse.json({ error: "Firma de Mercado Pago inválida." }, { status: 401 });
    }

    const provider = new MercadoPagoProvider(config);
    const payment = await provider.getPayment(resourceId);

    if (payment.application_id && text(payment.application_id) !== config.applicationId) {
      return NextResponse.json({ error: "El pago pertenece a otra aplicación." }, { status: 400 });
    }
    if (payment.collector_id && text(payment.collector_id) !== config.userId) {
      return NextResponse.json({ error: "El pago pertenece a otro vendedor." }, { status: 400 });
    }

    const externalReference = text(payment.external_reference);
    if (!externalReference) {
      return NextResponse.json({ error: "El pago no tiene external_reference." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { data: order, error: orderError } = await admin
      .from("commerce_orders")
      .select("id,buyer_id,total,currency,payment_status,fulfillment_status")
      .eq("external_reference", externalReference)
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);
    if (!order) {
      return NextResponse.json({ error: "No encontramos la orden interna de ese pago." }, { status: 404 });
    }

    const amount = Number(payment.transaction_amount);
    if (!Number.isFinite(amount) || Math.abs(amount - Number(order.total)) > 0.01) {
      throw new Error("El importe del pago no coincide con la orden.");
    }
    if (text(payment.currency_id) !== order.currency) {
      throw new Error("La moneda del pago no coincide con la orden.");
    }

    const paymentStatus = normalizePaymentStatus(payment.status);
    const providerDate = validProviderDate(payment.date_approved || payment.date_created);

    if (paymentStatus === "approved") {
      const { data: confirmation, error: confirmationError } = await admin.rpc(
        "confirm_commerce_order_payment",
        {
          p_order_id: order.id,
          p_payment_id: resourceId,
          p_paid_at: providerDate,
        },
      );
      if (confirmationError) throw new Error(confirmationError.message);

      const confirmationResult = confirmation as {
        processed?: boolean;
        duplicate?: boolean;
        stock_conflict?: boolean;
      } | null;

      const delivery = await deliverPurchasedItems(admin, order.id, resourceId);

      return NextResponse.json({
        received: true,
        processed: Boolean(confirmationResult?.processed),
        duplicate: Boolean(confirmationResult?.duplicate),
        stockConflict: Boolean(confirmationResult?.stock_conflict),
        deliveredItems: delivery.delivered,
        deliveryFailures: delivery.failures,
        orderId: order.id,
      });
    }

    if (["refunded", "charged_back"].includes(paymentStatus)) {
      const { data: refund, error: refundError } = await admin.rpc(
        "refund_commerce_order_payment",
        {
          p_order_id: order.id,
          p_payment_id: resourceId,
          p_refunded_at: providerDate,
        },
      );
      if (refundError) throw new Error(refundError.message);

      return NextResponse.json({
        received: true,
        processed: true,
        refund,
        orderId: order.id,
      });
    }

    if (["pending", "in_process", "in_mediation", "authorized"].includes(paymentStatus)) {
      if (order.payment_status !== "paid" && order.payment_status !== "refunded") {
        const { error: pendingError } = await admin
          .from("commerce_orders")
          .update({ payment_status: "pending", external_payment_id: resourceId })
          .eq("id", order.id);
        if (pendingError) throw new Error(pendingError.message);
      }

      await recordEvent(admin, {
        orderId: order.id,
        eventType: "payment_pending",
        note: `Mercado Pago informó el estado ${paymentStatus}.`,
        dedupeKey: `payment:${resourceId}:${paymentStatus}`,
        metadata: { payment_id: resourceId, payment_status: paymentStatus },
      });

      return NextResponse.json({ received: true, processed: true, paymentStatus, orderId: order.id });
    }

    if (["rejected", "cancelled"].includes(paymentStatus)) {
      if (order.payment_status === "paid" || order.payment_status === "refunded") {
        return NextResponse.json({
          received: true,
          ignored: true,
          reason: "final_payment_state_preserved",
          orderId: order.id,
        });
      }

      const { error: failedError } = await admin
        .from("commerce_orders")
        .update({
          payment_status: "failed",
          status: "cancelled",
          fulfillment_status: "cancelled",
          external_payment_id: resourceId,
        })
        .eq("id", order.id);
      if (failedError) throw new Error(failedError.message);

      await recordEvent(admin, {
        orderId: order.id,
        eventType: paymentStatus === "rejected" ? "payment_rejected" : "payment_cancelled",
        note: `Mercado Pago informó el estado ${paymentStatus}.`,
        dedupeKey: `payment:${resourceId}:${paymentStatus}`,
        metadata: { payment_id: resourceId, payment_status: paymentStatus },
      });

      return NextResponse.json({ received: true, processed: true, paymentStatus, orderId: order.id });
    }

    return NextResponse.json({
      received: true,
      ignored: true,
      reason: `payment_${paymentStatus || "unknown"}`,
      orderId: order.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo procesar la notificación.";
    console.error("mercadopago_commerce_orders_webhook_failed", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
