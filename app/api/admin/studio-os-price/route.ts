import { NextRequest, NextResponse } from "next/server";
import { getBillingEnvironment } from "@/core/billing/providers/mercadopago/config";
import { provisionProductPlan } from "@/core/billing/service";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requirePlatformAdmin(request: NextRequest) {
  const { user } = await requireUser(request);
  const admin = createAdminSupabase();
  const { data: profile, error } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (profile?.role !== "admin") {
    const forbidden = new Error("Solo el administrador de CLOUVA puede configurar Studio OS.");
    (forbidden as Error & { status?: number }).status = 403;
    throw forbidden;
  }
  return { user, admin };
}

async function loadState(admin: ReturnType<typeof createAdminSupabase>) {
  const environment = getBillingEnvironment();
  const { data: product, error: productError } = await admin
    .from("billing_products")
    .select("id,code,name,description,is_active")
    .eq("code", "clouva_studio_os")
    .maybeSingle();
  if (productError) throw new Error(productError.message);
  if (!product) return { environment, product: null, price: null };

  const { data: price, error: priceError } = await admin
    .from("billing_prices")
    .select("id,amount,currency,billing_interval,interval_count,provider_plan_id,is_active,created_at")
    .eq("product_id", product.id)
    .eq("provider", "mercadopago")
    .eq("environment", environment)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (priceError) throw new Error(priceError.message);
  return { environment, product, price };
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requirePlatformAdmin(request);
    return NextResponse.json(await loadState(admin));
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cargar Studio OS." }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, admin } = await requirePlatformAdmin(request);
    const body = (await request.json().catch(() => ({}))) as {
      amount?: unknown;
      currency?: unknown;
      billingInterval?: unknown;
    };
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: "Ingresá un precio mayor que cero." }, { status: 400 });
    }
    const currency = typeof body.currency === "string" && body.currency.trim()
      ? body.currency.trim().slice(0, 3).toUpperCase()
      : "ARS";
    const billingInterval = body.billingInterval === "year" ? "year" : "month";
    const environment = getBillingEnvironment();

    let { data: product, error: productError } = await admin
      .from("billing_products")
      .select("id")
      .eq("code", "clouva_studio_os")
      .maybeSingle();
    if (productError) throw new Error(productError.message);
    if (!product) {
      const created = await admin
        .from("billing_products")
        .insert({
          code: "clouva_studio_os",
          name: "CLOUVA Studio OS",
          description: "Sistema operativo para crear, administrar y monetizar un Estudio dentro de CLOUVA.",
          entitlement_tier: "studio_member",
          is_active: false,
          metadata: { product_scope: "studio_os" },
        })
        .select("id")
        .single();
      if (created.error) throw new Error(created.error.message);
      product = created.data;
    }

    const { data: newPrice, error: insertError } = await admin
      .from("billing_prices")
      .insert({
        product_id: product.id,
        provider: "mercadopago",
        provider_plan_id: null,
        currency,
        amount,
        billing_interval: billingInterval,
        interval_count: 1,
        environment,
        is_active: false,
      })
      .select("id")
      .single();
    if (insertError) throw new Error(insertError.message);

    try {
      await provisionProductPlan(admin, newPrice.id);
    } catch (provisionError) {
      await admin.from("billing_prices").delete().eq("id", newPrice.id).is("provider_plan_id", null);
      throw provisionError;
    }

    const { error: deactivateError } = await admin
      .from("billing_prices")
      .update({ is_active: false })
      .eq("product_id", product.id)
      .eq("environment", environment)
      .neq("id", newPrice.id);
    if (deactivateError) throw new Error(deactivateError.message);

    await admin.from("admin_audit_log").insert({
      admin_user_id: user.id,
      action: "studio_os.price.configured",
      entity_type: "billing_product",
      entity_id: product.id,
      reason: "Precio de Studio OS configurado desde el panel admin",
      metadata: { amount, currency, billing_interval: billingInterval, environment, price_id: newPrice.id },
    });

    return NextResponse.json(await loadState(admin));
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo configurar Studio OS." }, { status });
  }
}
