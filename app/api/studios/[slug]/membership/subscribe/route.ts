import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getBillingEnvironment, isBillingEnabled } from "@/core/billing/providers/mercadopago/config";
import { createSubscriptionForProduct, provisionProductPlan } from "@/core/billing/service";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { resolveStudioForMembership } from "@/lib/server/studio-membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ensureBillingProduct(
  admin: ReturnType<typeof createAdminSupabase>,
  studio: { id: string; name: string },
  plan: { id: string; name: string; billing_product_id: string | null; price: number; currency: string; billing_interval: "month" | "year" },
) {
  if (plan.billing_product_id) return plan.billing_product_id;

  const { data: product, error: productError } = await admin
    .from("billing_products")
    .insert({
      code: `studio_${studio.id}_${plan.id}`,
      name: `${studio.name} — ${plan.name}`,
      entitlement_tier: "studio_member",
      is_active: true,
      studio_id: studio.id,
      metadata: { product_scope: "studio_membership", membership_plan_id: plan.id },
    })
    .select("id")
    .single();
  if (productError) throw new Error(productError.message);

  const { data: price, error: priceError } = await admin
    .from("billing_prices")
    .insert({
      product_id: product.id,
      provider: "mercadopago",
      currency: plan.currency,
      amount: plan.price,
      billing_interval: plan.billing_interval,
      environment: getBillingEnvironment(),
      is_active: false,
    })
    .select("id")
    .single();
  if (priceError) throw new Error(priceError.message);

  await provisionProductPlan(admin, price.id);

  const { error: linkError } = await admin
    .from("studio_membership_plans")
    .update({ billing_product_id: product.id })
    .eq("id", plan.id);
  if (linkError) throw new Error(linkError.message);

  return product.id as string;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    if (!isBillingEnabled()) return NextResponse.json({ error: "Los pagos todavía no están habilitados." }, { status: 503 });
    const { user } = await requireUser(request);
    if (!user.email) return NextResponse.json({ error: "Tu cuenta necesita un correo válido para pagar." }, { status: 400 });

    const { slug } = await params;
    const admin = createAdminSupabase();
    const studio = await resolveStudioForMembership(admin, slug);
    const body = (await request.json().catch(() => ({}))) as { planId?: unknown };
    const planId = typeof body.planId === "string" ? body.planId : "";
    if (!planId) return NextResponse.json({ error: "Falta elegir un plan." }, { status: 400 });

    const { data: plan, error: planError } = await admin
      .from("studio_membership_plans")
      .select("id,studio_id,slug,name,is_free,is_active,is_public,join_policy,requires_approval,billing_product_id,price,currency,billing_interval")
      .eq("id", planId)
      .eq("studio_id", studio.id)
      .maybeSingle();
    if (planError) throw new Error(planError.message);
    if (!plan || !plan.is_active || !plan.is_public || plan.is_free) {
      return NextResponse.json({ error: "Ese plan no está disponible." }, { status: 404 });
    }
    if (plan.join_policy === "invitation_only") {
      return NextResponse.json({ error: "Este plan solo está disponible mediante invitación." }, { status: 403 });
    }
    if (plan.requires_approval || plan.join_policy === "approval") {
      return NextResponse.json({
        error: "Este plan requiere aprobación del Estudio antes del pago. La solicitud debe aprobarse primero para no cobrar sin acceso confirmado.",
        requiresApproval: true,
      }, { status: 409 });
    }
    if (plan.price == null || !plan.billing_interval) {
      return NextResponse.json({ error: "El plan pago no tiene precio o frecuencia configurados." }, { status: 409 });
    }

    const billingProductId = await ensureBillingProduct(admin, studio, plan as {
      id: string;
      name: string;
      billing_product_id: string | null;
      price: number;
      currency: string;
      billing_interval: "month" | "year";
    });

    const idempotencyKey = request.headers.get("x-idempotency-key")?.trim() || randomUUID();
    const appBase = process.env.APP_BASE_URL?.trim() || "https://clouva.com.ar";
    const result = await createSubscriptionForProduct({
      admin,
      userId: user.id,
      payerEmail: user.email,
      productId: billingProductId,
      studioId: studio.id,
      reason: `${studio.name} — ${plan.name}`,
      backUrl: `${appBase}/studios/${studio.slug}/checkout?plan=${encodeURIComponent(plan.slug)}&status=pending`,
      idempotencyKey,
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo iniciar el pago.";
    return NextResponse.json({ error: message }, { status });
  }
}
