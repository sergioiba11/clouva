import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { getMercadoPagoConfig } from "@/core/billing/providers/mercadopago/config";
import { verifyMercadoPagoSignature } from "@/core/billing/providers/mercadopago/signature";
import { queueRatcraftCommand } from "@/lib/server/ratcraft-command-queue";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

    const topic = text(body.type || body.topic).trim().toLowerCase();
    const resourceId = text(body.data?.id || request.nextUrl.searchParams.get("data.id") || request.nextUrl.searchParams.get("id"));

    if (!topic || !resourceId) return NextResponse.json({ error: "Notificación incompleta." }, { status: 400 });
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
    const { data: pass, error: passError } = await admin
      .from("ratcraft_access_passes")
      .select("id,minecraft_name,amount,currency,status,whitelist_status")
      .eq("external_reference", externalReference)
      .maybeSingle();
    if (passError) throw new Error(passError.message);
    if (!pass) return NextResponse.json({ error: "No encontramos el pase interno." }, { status: 404 });

    const amount = Number(payment.transaction_amount);
    if (!Number.isFinite(amount) || Math.abs(amount - Number(pass.amount)) > 0.01) {
      throw new Error("El importe del pago no coincide con el pase.");
    }
    if (text(payment.currency_id) !== pass.currency) throw new Error("La moneda del pago no coincide con el pase.");

    const paymentStatus = text(payment.status).trim().toLowerCase();
    const now = new Date().toISOString();

    if (paymentStatus === "approved") {
      const paidAtRaw = text(payment.date_approved || payment.date_created);
      const paidAt = paidAtRaw && !Number.isNaN(Date.parse(paidAtRaw)) ? paidAtRaw : now;

      if (pass.status !== "approved") {
        const { error: paidError } = await admin
          .from("ratcraft_access_passes")
          .update({
            status: "approved",
            external_payment_id: resourceId,
            paid_at: paidAt,
            failure_reason: null,
            updated_at: now,
          })
          .eq("id", pass.id);
        if (paidError) throw new Error(paidError.message);
      }

      if (pass.whitelist_status !== "queued" && pass.whitelist_status !== "active") {
        try {
          await queueRatcraftCommand("whitelist_add", { player: pass.minecraft_name }, `mercadopago:${resourceId}`);
          await admin
            .from("ratcraft_access_passes")
            .update({ whitelist_status: "queued", whitelist_queued_at: now, failure_reason: null, updated_at: now })
            .eq("id", pass.id);
        } catch (queueError) {
          await admin
            .from("ratcraft_access_passes")
            .update({
              whitelist_status: "failed",
              failure_reason: queueError instanceof Error ? queueError.message.slice(0, 500) : "whitelist_queue_error",
              updated_at: now,
            })
            .eq("id", pass.id);
          throw queueError;
        }
      }

      return NextResponse.json({ received: true, processed: true, passId: pass.id });
    }

    if (["pending", "in_process", "in_mediation", "authorized"].includes(paymentStatus)) {
      await admin.from("ratcraft_access_passes").update({
        status: "pending",
        external_payment_id: resourceId,
        updated_at: now,
      }).eq("id", pass.id);
      return NextResponse.json({ received: true, processed: true, paymentStatus });
    }

    if (paymentStatus === "refunded" || paymentStatus === "charged_back") {
      await admin.from("ratcraft_access_passes").update({
        status: "refunded",
        external_payment_id: resourceId,
        updated_at: now,
      }).eq("id", pass.id);
      try {
        await queueRatcraftCommand("whitelist_remove", { player: pass.minecraft_name }, `mercadopago-refund:${resourceId}`);
        await admin.from("ratcraft_access_passes").update({ whitelist_status: "removed", updated_at: now }).eq("id", pass.id);
      } catch {
        await admin.from("ratcraft_access_passes").update({ whitelist_status: "failed", updated_at: now }).eq("id", pass.id);
      }
      return NextResponse.json({ received: true, processed: true, paymentStatus });
    }

    const status = paymentStatus === "rejected" ? "rejected" : "cancelled";
    await admin.from("ratcraft_access_passes").update({
      status,
      external_payment_id: resourceId,
      updated_at: now,
    }).eq("id", pass.id);

    return NextResponse.json({ received: true, processed: true, paymentStatus });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo procesar el pago Ratcraft.";
    console.error("mercadopago_ratcraft_access_webhook_failed", { message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
