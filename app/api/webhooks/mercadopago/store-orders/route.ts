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
    const config = getMercadoPagoConfig();
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
      .from("orders")
      .select("id,total,currency,payment_status,external_payment_id")
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
    const paidAtRaw = text(payment.date_approved || payment.date_created);
    const paidAt = paidAtRaw && !Number.isNaN(Date.parse(paidAtRaw)) ? paidAtRaw : new Date().toISOString();

    if (paymentStatus === "approved") {
      if (order.payment_status === "pagado") {
        return NextResponse.json({ received: true, duplicate: true, orderId: order.id });
      }

      const { data: confirmed, error: confirmationError } = await admin.rpc("confirm_store_order_payment", {
        p_order_id: order.id,
        p_payment_id: resourceId,
        p_paid_at: paidAt,
      });

      if (confirmationError) {
        // A payment is an external financial fact and must never disappear
        // from CLOUVA because stock changed while the payer was in Checkout
        // Pro. Record it as paid and surface the exceptional fulfillment case
        // in history so the admin can resolve it explicitly.
        if (/stock insuficiente/i.test(confirmationError.message)) {
          const { error: paidWithConflictError } = await admin
            .from("orders")
            .update({
              payment_status: "pagado",
              status: "confirmado",
              payment_method: "mercadopago",
              external_payment_id: resourceId,
              paid_at: paidAt,
            })
            .eq("id", order.id);
          if (paidWithConflictError) throw new Error(paidWithConflictError.message);

          await admin.from("order_status_history").insert({
            order_id: order.id,
            status: "pagado_stock_insuficiente",
            note: `Pago ${resourceId} aprobado; revisar disponibilidad física antes de preparar.`,
          });

          return NextResponse.json({ received: true, processed: true, stockConflict: true, orderId: order.id });
        }
        throw new Error(confirmationError.message);
      }

      if (confirmed) {
        await admin.from("order_status_history").insert({
          order_id: order.id,
          status: "pagado",
          note: `Pago Mercado Pago ${resourceId} aprobado.`,
        });
      }

      return NextResponse.json({ received: true, processed: Boolean(confirmed), duplicate: !confirmed, orderId: order.id });
    }

    const isRefund = paymentStatus === "refunded" || paymentStatus === "charged_back";
    if (order.payment_status === "pagado" && !isRefund) {
      return NextResponse.json({ received: true, ignored: true, reason: "paid_order_is_final", orderId: order.id });
    }

    let patch: Record<string, unknown>;
    let historyStatus: string;

    if (["pending", "in_process", "in_mediation", "authorized"].includes(paymentStatus)) {
      patch = {
        payment_status: "pendiente_aprobacion",
        external_payment_id: resourceId,
      };
      historyStatus = "pago_en_proceso";
    } else if (paymentStatus === "rejected") {
      patch = {
        payment_status: "rechazado",
        status: "cancelado",
        external_payment_id: resourceId,
      };
      historyStatus = "pago_rechazado";
    } else if (paymentStatus === "cancelled") {
      patch = {
        payment_status: "cancelado",
        shipping_status: "cancelado",
        status: "cancelado",
        external_payment_id: resourceId,
      };
      historyStatus = "pago_cancelado";
    } else if (isRefund) {
      patch = {
        payment_status: "reembolsado",
        shipping_status: "cancelado",
        status: "cancelado",
        external_payment_id: resourceId,
      };
      historyStatus = "pago_reembolsado";
    } else {
      return NextResponse.json({ received: true, ignored: true, reason: `payment_${paymentStatus || "unknown"}` });
    }

    const { error: updateError } = await admin.from("orders").update(patch).eq("id", order.id);
    if (updateError) throw new Error(updateError.message);

    await admin.from("order_status_history").insert({
      order_id: order.id,
      status: historyStatus,
      note: `Mercado Pago informó estado “${paymentStatus}” para el pago ${resourceId}.`,
    });

    return NextResponse.json({ received: true, processed: true, orderId: order.id, paymentStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo procesar la notificación.";
    console.error("mercadopago_store_orders_webhook_failed", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
