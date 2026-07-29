import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { getMercadoPagoConfig } from "@/core/billing/providers/mercadopago/config";
import { mapMercadoPagoSubscriptionStatus } from "@/core/billing/providers/mercadopago/mapper";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const admin = createAdminSupabase();
    const { data: subscription, error } = await admin
      .from("billing_subscriptions")
      .select("id,user_id,environment,external_subscription_id,status,current_period_end")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!subscription) return NextResponse.json({ error: "No encontramos esa suscripción." }, { status: 404 });
    if (!subscription.external_subscription_id) {
      return NextResponse.json({ error: "La suscripción todavía no fue creada en Mercado Pago." }, { status: 409 });
    }
    if (["cancelled", "expired"].includes(subscription.status as string)) {
      return NextResponse.json({ cancelled: true, status: subscription.status });
    }

    const environment = subscription.environment as "test" | "production";
    const providerData = await new MercadoPagoProvider(getMercadoPagoConfig(environment))
      .cancelSubscription(subscription.external_subscription_id as string);
    const providerStatus = String(providerData.status || "cancelled");
    const status = mapMercadoPagoSubscriptionStatus(providerStatus);
    const now = new Date().toISOString();
    const periodEnd = subscription.current_period_end as string | null;
    const benefitsRemainActive = Boolean(periodEnd && new Date(periodEnd) > new Date());

    const { error: updateError } = await admin
      .from("billing_subscriptions")
      .update({
        status,
        provider_status: providerStatus,
        cancel_at_period_end: benefitsRemainActive,
        cancelled_at: now,
        last_verified_at: now,
      })
      .eq("id", subscription.id);
    if (updateError) throw new Error(updateError.message);

    if (!benefitsRemainActive) {
      await admin
        .from("user_entitlements")
        .update({ status: "cancelled", valid_until: now, expires_at: now, cancelled_at: now, last_verified_at: now })
        .eq("source_subscription_id", subscription.id)
        .eq("user_id", user.id)
        .eq("status", "active");
    }

    return NextResponse.json({
      cancelled: status === "cancelled",
      status,
      benefitsUntil: benefitsRemainActive ? periodEnd : now,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo cancelar la suscripción.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}
