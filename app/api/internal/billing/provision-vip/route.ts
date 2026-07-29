import { NextRequest, NextResponse } from "next/server";
import { provisionVipPlan } from "@/core/billing/service";
import { isBillingEnabled } from "@/core/billing/providers/mercadopago/config";
import { createAdminSupabase } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const expected = process.env.INTERNAL_RECONCILIATION_SECRET?.trim();
  const received = request.headers.get("x-clouva-internal-secret")?.trim();
  return Boolean(expected && received && expected === received);
}

export async function POST(request: NextRequest) {
  try {
    if (!authorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    if (!isBillingEnabled()) return NextResponse.json({ error: "Billing está desactivado." }, { status: 503 });

    const body = (await request.json().catch(() => ({}))) as { priceId?: string };
    if (!body.priceId) return NextResponse.json({ error: "Falta priceId." }, { status: 400 });

    const result = await provisionVipPlan(createAdminSupabase(), body.priceId);
    return NextResponse.json({
      created: result.created,
      priceId: result.price.id,
      providerPlanId: result.price.provider_plan_id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo aprovisionar el plan.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
