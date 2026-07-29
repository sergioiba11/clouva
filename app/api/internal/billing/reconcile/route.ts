import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { getMercadoPagoConfig } from "@/core/billing/providers/mercadopago/config";
import { mapMercadoPagoSubscriptionStatus } from "@/core/billing/providers/mercadopago/mapper";
import { processApprovedPayment } from "@/core/billing/service";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const expected = process.env.INTERNAL_RECONCILIATION_SECRET?.trim();
  const received = request.headers.get("x-clouva-internal-secret")?.trim();
  return Boolean(expected && received && expected === received);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const admin = createAdminSupabase();
  const { data: subscriptions, error } = await admin
    .from("billing_subscriptions")
    .select("id,environment,external_subscription_id,external_reference,status,current_period_end")
    .in("status", ["created", "pending", "authorized", "active", "past_due", "paused", "error"])
    .not("external_subscription_id", "is", null)
    .order("last_verified_at", { ascending: true, nullsFirst: true })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Array<Record<string, unknown>> = [];
  for (const subscription of subscriptions ?? []) {
    try {
      const environment = subscription.environment as "test" | "production";
      const provider = new MercadoPagoProvider(getMercadoPagoConfig(environment));
      const providerData = await provider.getSubscription(subscription.external_subscription_id as string);
      if (String(providerData.external_reference || "") !== subscription.external_reference) {
        throw new Error("external_reference no coincide");
      }

      const providerStatus = String(providerData.status || "pending");
      const status = mapMercadoPagoSubscriptionStatus(providerStatus);
      const now = new Date().toISOString();
      const { error: updateError } = await admin.from("billing_subscriptions").update({
        status,
        provider_status: providerStatus,
        next_payment_at: providerData.next_payment_date || null,
        last_verified_at: now,
        cancelled_at: status === "cancelled" ? now : null,
      }).eq("id", subscription.id);
      if (updateError) throw new Error(updateError.message);

      const authorizedPayments = await fetch(
        `${getMercadoPagoConfig(environment).apiBaseUrl}/authorized_payments/search?preapproval_id=${encodeURIComponent(subscription.external_subscription_id as string)}&limit=20`,
        {
          headers: { authorization: `Bearer ${getMercadoPagoConfig(environment).accessToken}` },
          cache: "no-store",
        },
      );
      if (authorizedPayments.ok) {
        const payload = (await authorizedPayments.json()) as { results?: Array<{ payment?: { id?: string | number; status?: string } }> };
        for (const invoice of payload.results ?? []) {
          const paymentId = invoice.payment?.id ? String(invoice.payment.id) : "";
          if (paymentId && invoice.payment?.status === "approved") {
            await processApprovedPayment({ admin, paymentId, environment });
          }
        }
      }

      if ((status === "cancelled" || status === "expired") && subscription.current_period_end) {
        const end = new Date(subscription.current_period_end as string);
        if (end <= new Date()) {
          await admin.from("user_entitlements").update({
            status: status === "expired" ? "expired" : "cancelled",
            valid_until: end.toISOString(),
            expires_at: end.toISOString(),
            last_verified_at: now,
          }).eq("source_subscription_id", subscription.id).eq("status", "active");
        }
      }

      results.push({ subscriptionId: subscription.id, ok: true, status });
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "unknown";
      results.push({ subscriptionId: subscription.id, ok: false, error: message });
      await admin.from("billing_subscriptions").update({
        last_verified_at: new Date().toISOString(),
        metadata: { reconciliation_error: message },
      }).eq("id", subscription.id);
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
