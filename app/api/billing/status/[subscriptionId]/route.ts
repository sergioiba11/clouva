import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ subscriptionId: string }> },
) {
  try {
    const { user } = await requireUser(request);
    const { subscriptionId } = await context.params;
    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("billing_subscriptions")
      .select("id,status,provider_status,current_period_start,current_period_end,next_payment_at,cancel_at_period_end,cancelled_at,last_verified_at,created_at,product:billing_products(code,name),price:billing_prices(currency,amount,billing_interval,interval_count)")
      .eq("id", subscriptionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "No encontramos esa suscripción." }, { status: 404 });

    const { data: entitlement, error: entitlementError } = await admin
      .from("user_entitlements")
      .select("tier,status,starts_at,expires_at,valid_from,valid_until,last_verified_at")
      .eq("source_subscription_id", subscriptionId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (entitlementError) throw new Error(entitlementError.message);

    return NextResponse.json({ subscription: data, entitlement: entitlement ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo consultar la suscripción.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}
