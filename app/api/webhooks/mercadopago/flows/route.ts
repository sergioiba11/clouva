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

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function paymentEconomics(payment: Record<string, unknown>, grossAmount: number) {
  const transactionDetails = payment.transaction_details && typeof payment.transaction_details === "object" && !Array.isArray(payment.transaction_details)
    ? (payment.transaction_details as Record<string, unknown>)
    : null;
  const reportedNet = finiteNumber(transactionDetails?.net_received_amount);

  const feeDetails = Array.isArray(payment.fee_details) ? payment.fee_details : [];
  const feeSum = feeDetails.reduce((sum, entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return sum;
    const amount = finiteNumber((entry as Record<string, unknown>).amount);
    return sum + Math.max(amount ?? 0, 0);
  }, 0);

  const netAmount = reportedNet != null && reportedNet >= 0
    ? Math.min(reportedNet, grossAmount)
    : Math.max(grossAmount - feeSum, 0);
  const providerFee = Math.max(grossAmount - netAmount, 0);
  return { providerFee, netAmount };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      id?: string | number;
      type?: string;
      topic?: string;
      data?: { id?: string | number };
    };
    const topic = text(body.type || body.topic).trim().toLowerCase();
    const resourceId = text(body.data?.id || request.nextUrl.searchParams.get("data.id") || request.nextUrl.searchParams.get("id"));
    if (!topic || !resourceId) return NextResponse.json({ error: "Notificación sin tipo o recurso." }, { status: 400 });
    if (topic !== "payment") return NextResponse.json({ received: true, ignored: true, topic });

    const config = getMercadoPagoConfig();
    const validSignature = verifyMercadoPagoSignature({
      xSignature: request.headers.get("x-signature") || "",
      xRequestId: request.headers.get("x-request-id") || "",
      dataId: resourceId,
      secret: config.webhookSecret,
    });
    if (!validSignature) return NextResponse.json({ error: "Firma de Mercado Pago inválida." }, { status: 401 });

    const payment = await new MercadoPagoProvider(config).getPayment(resourceId);
    if (payment.application_id && text(payment.application_id) !== config.applicationId) {
      return NextResponse.json({ error: "El pago pertenece a otra aplicación." }, { status: 400 });
    }
    if (payment.collector_id && text(payment.collector_id) !== config.userId) {
      return NextResponse.json({ error: "El pago pertenece a otro vendedor." }, { status: 400 });
    }

    const externalReference = text(payment.external_reference);
    if (!externalReference) return NextResponse.json({ error: "El pago no tiene external_reference." }, { status: 400 });

    const admin = createAdminSupabase();
    const { data: operation, error: operationError } = await admin
      .from("flow_purchase_operations")
      .select("id,amount,currency,status,issued_at,provider_payment_id")
      .eq("provider", "mercadopago")
      .eq("provider_reference", externalReference)
      .maybeSingle();
    if (operationError) throw new Error(operationError.message);
    if (!operation) return NextResponse.json({ error: "No encontramos la compra de FLOWS asociada." }, { status: 404 });

    const amount = Number(payment.transaction_amount);
    if (!Number.isFinite(amount) || Math.abs(amount - Number(operation.amount)) > 0.01) {
      throw new Error("El importe del pago no coincide con la compra de FLOWS.");
    }
    const currency = text(payment.currency_id).toUpperCase();
    if (currency !== operation.currency.toUpperCase()) throw new Error("La moneda del pago no coincide con la compra de FLOWS.");

    const paymentStatus = text(payment.status).trim().toLowerCase();
    const approvedAtRaw = text(payment.date_approved || payment.date_created);
    const approvedAt = approvedAtRaw && !Number.isNaN(Date.parse(approvedAtRaw)) ? approvedAtRaw : new Date().toISOString();

    if (paymentStatus === "approved") {
      const { providerFee, netAmount } = paymentEconomics(payment, amount);
      const { data: issued, error: confirmationError } = await admin.rpc("confirm_flow_external_payment", {
        p_operation_id: operation.id,
        p_provider: "mercadopago",
        p_provider_payment_id: resourceId,
        p_confirmed_at: approvedAt,
        p_amount: amount,
        p_currency: currency,
        p_idempotency_key: `mercadopago-payment:${resourceId}`,
        p_metadata: {
          paymentStatus,
          paymentMethodId: text(payment.payment_method_id) || null,
          paymentTypeId: text(payment.payment_type_id) || null,
          statusDetail: text(payment.status_detail) || null,
          providerFee,
          netAmount,
          grossAmount: amount,
        },
      });
      if (confirmationError) throw new Error(confirmationError.message);
      return NextResponse.json({ received: true, processed: true, operationId: operation.id, issued });
    }

    if (["refunded", "charged_back"].includes(paymentStatus)) {
      const { data: refund, error: refundError } = await admin.rpc("record_flow_refund", {
        p_operation_id: operation.id,
        p_provider_payment_id: resourceId,
        p_amount: amount,
        p_currency: currency,
        p_reason: paymentStatus,
        p_idempotency_key: `mercadopago-refund:${resourceId}:${paymentStatus}`,
        p_metadata: { paymentStatus, statusDetail: text(payment.status_detail) || null },
      });
      if (refundError) throw new Error(refundError.message);
      return NextResponse.json({ received: true, processed: true, operationId: operation.id, refund });
    }

    const nextStatus = paymentStatus === "rejected" ? "failed"
      : paymentStatus === "cancelled" ? "cancelled"
      : "pending";

    if (!operation.issued_at || nextStatus === "pending") {
      const { error: updateError } = await admin
        .from("flow_purchase_operations")
        .update({ status: nextStatus, provider_payment_id: resourceId, updated_at: new Date().toISOString() })
        .eq("id", operation.id)
        .in("status", ["pending", nextStatus]);
      if (updateError) throw new Error(updateError.message);
    }

    return NextResponse.json({ received: true, processed: true, operationId: operation.id, paymentStatus, status: nextStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo procesar el pago de FLOWS.";
    console.error("mercadopago_flows_webhook_failed", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
