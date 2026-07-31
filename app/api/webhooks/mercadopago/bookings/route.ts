import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { getMercadoPagoConfig } from "@/core/billing/providers/mercadopago/config";
import { isApprovedPayment } from "@/core/billing/providers/mercadopago/mapper";
import { verifyMercadoPagoSignature } from "@/core/billing/providers/mercadopago/signature";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function text(value: unknown) {
  return value == null ? "" : String(value);
}

// Same verification pattern as the service-orders/commerce-orders webhooks,
// targeting bookings. A paid fixed-price booking goes straight to
// 'confirmed' -- no separate manual confirmation step needed once Mercado
// Pago verified the money.
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
    const { data: booking, error: bookingError } = await admin
      .from("bookings")
      .select("id,price,currency,payment_status")
      .eq("external_reference", externalReference)
      .maybeSingle();
    if (bookingError) throw new Error(bookingError.message);
    if (!booking) return NextResponse.json({ error: "No encontramos la reserva interna de ese pago." }, { status: 404 });

    if (booking.payment_status === "paid") return NextResponse.json({ received: true, duplicate: true });

    if (!isApprovedPayment(payment.status)) {
      await admin.from("bookings").update({ payment_status: "failed" }).eq("id", booking.id).eq("payment_status", "pending");
      return NextResponse.json({ received: true, processed: false, reason: `payment_${text(payment.status) || "unknown"}` });
    }

    const amount = Number(payment.transaction_amount);
    if (!Number.isFinite(amount) || Math.abs(amount - Number(booking.price)) > 0.01) {
      throw new Error("El importe del pago no coincide con la reserva.");
    }
    if (text(payment.currency_id) !== booking.currency) {
      throw new Error("La moneda del pago no coincide con la reserva.");
    }

    const { error: updateError } = await admin
      .from("bookings")
      .update({ payment_status: "paid", status: "confirmed", external_payment_id: resourceId })
      .eq("id", booking.id)
      .eq("payment_status", "pending");
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ received: true, processed: true, bookingId: booking.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo procesar la notificación.";
    console.error("mercadopago_bookings_webhook_failed", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
