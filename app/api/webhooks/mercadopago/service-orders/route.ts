import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { getMercadoPagoConfig } from "@/core/billing/providers/mercadopago/config";
import { isApprovedPayment } from "@/core/billing/providers/mercadopago/mapper";
import { verifyMercadoPagoSignature } from "@/core/billing/providers/mercadopago/signature";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Separate from /api/webhooks/mercadopago on purpose: that handler's
// processApprovedPayment() is hard-wired to billing_subscriptions +
// clouva_vip (throws if the product isn't VIP), so it can't also handle
// one-time studio-service payments. Same signature/ownership verification,
// different target table.
function text(value: unknown) {
  return value == null ? "" : String(value);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      id?: string | number;
      type?: string;
      topic?: string;
      data?: { id?: string | number };
    };
    const topic = text(body.type || body.topic).toLowerCase();
    const resourceId = text(body.data?.id || request.nextUrl.searchParams.get("data.id") || request.nextUrl.searchParams.get("id"));
    if (!topic || !resourceId) return NextResponse.json({ error: "Notificación sin tipo o recurso." }, { status: 400 });
    if (topic !== "payment") return NextResponse.json({ received: true, ignored: true, topic });

    const requestId = request.headers.get("x-request-id") || "";
    const signatureHeader = request.headers.get("x-signature") || "";
    const config = getMercadoPagoConfig("production");
    if (!verifyMercadoPagoSignature({ xSignature: signatureHeader, xRequestId: requestId, dataId: resourceId, secret: config.webhookSecret })) {
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
    if (!externalReference) return NextResponse.json({ error: "El pago no tiene external_reference." }, { status: 400 });

    const admin = createAdminSupabase();
    const { data: order, error: orderError } = await admin
      .from("service_orders")
      .select("id,total_amount,currency,payment_status,external_payment_id")
      .eq("external_reference", externalReference)
      .maybeSingle();
    if (orderError) throw new Error(orderError.message);
    if (!order) return NextResponse.json({ error: "No encontramos la orden interna de ese pago." }, { status: 404 });

    if (order.payment_status === "paid") return NextResponse.json({ received: true, duplicate: true });

    if (!isApprovedPayment(payment.status)) {
      await admin.from("service_orders").update({ payment_status: "failed" }).eq("id", order.id).eq("payment_status", "pending");
      return NextResponse.json({ received: true, processed: false, reason: `payment_${text(payment.status) || "unknown"}` });
    }

    const amount = Number(payment.transaction_amount);
    if (!Number.isFinite(amount) || Math.abs(amount - Number(order.total_amount)) > 0.01) {
      throw new Error("El importe del pago no coincide con la orden.");
    }
    if (text(payment.currency_id) !== order.currency) {
      throw new Error("La moneda del pago no coincide con la orden.");
    }

    const { error: updateError } = await admin
      .from("service_orders")
      .update({ payment_status: "paid", status: "confirmed", external_payment_id: resourceId })
      .eq("id", order.id)
      .eq("payment_status", "pending");
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ received: true, processed: true, orderId: order.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo procesar la notificación.";
    console.error("mercadopago_service_orders_webhook_failed", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
