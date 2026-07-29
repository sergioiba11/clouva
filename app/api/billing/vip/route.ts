import { NextRequest, NextResponse } from "next/server";
import { getBillingEnvironment, isBillingEnabled } from "@/core/billing/providers/mercadopago/config";
import { createAdminSupabase, createUserSupabase, readBearerToken } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const admin = createAdminSupabase();
    const environment = getBillingEnvironment();
    const { data: price, error: priceError } = await admin
      .from("billing_prices")
      .select("id,currency,amount,billing_interval,interval_count,environment,is_active,product:billing_products!inner(code,name,description,entitlement_tier,is_active)")
      .eq("provider", "mercadopago")
      .eq("environment", environment)
      .eq("is_active", true)
      .eq("product.code", "clouva_vip")
      .eq("product.is_active", true)
      .limit(1)
      .maybeSingle();
    if (priceError) throw new Error(priceError.message);

    const accessToken = readBearerToken(request);
    let userId: string | null = null;
    if (accessToken) {
      const client = createUserSupabase(accessToken);
      const { data } = await client.auth.getUser(accessToken);
      userId = data.user?.id || null;
    }

    let subscription = null;
    let entitlement = null;
    if (userId) {
      const [subscriptionResult, entitlementResult] = await Promise.all([
        admin.from("billing_subscriptions").select("id,status,provider_status,current_period_start,current_period_end,next_payment_at,cancel_at_period_end,cancelled_at,last_verified_at,metadata").eq("user_id", userId).eq("provider", "mercadopago").eq("environment", environment).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        admin.from("user_entitlements").select("tier,status,starts_at,expires_at,valid_from,valid_until,last_verified_at,source_subscription_id").eq("user_id", userId).eq("product_code", "clouva_vip").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (subscriptionResult.error) throw new Error(subscriptionResult.error.message);
      if (entitlementResult.error) throw new Error(entitlementResult.error.message);
      subscription = subscriptionResult.data ? {
        ...subscriptionResult.data,
        init_point: (subscriptionResult.data.metadata as Record<string, unknown> | null)?.init_point || null,
        metadata: undefined,
      } : null;
      entitlement = entitlementResult.data;
    }

    return NextResponse.json({
      enabled: isBillingEnabled(),
      environment,
      price: price ? {
        id: price.id,
        currency: price.currency,
        amount: price.amount,
        billing_interval: price.billing_interval,
        interval_count: price.interval_count,
        product: price.product,
      } : null,
      subscription,
      entitlement,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo cargar CLOUVA VIP.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
