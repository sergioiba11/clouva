import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { MercadoPagoProvider } from "./providers/mercadopago/client";
import { getBillingEnvironment, getMercadoPagoConfig } from "./providers/mercadopago/config";
import { isApprovedPayment, mapMercadoPagoSubscriptionStatus } from "./providers/mercadopago/mapper";

function text(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function iso(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function addBillingInterval(start: Date, interval: string, count: number) {
  const result = new Date(start);
  if (interval === "year") result.setUTCFullYear(result.getUTCFullYear() + count);
  else result.setUTCMonth(result.getUTCMonth() + count);
  return result;
}

export type BillingPriceRow = {
  id: string;
  product_id: string;
  provider: "mercadopago";
  provider_plan_id: string | null;
  currency: string;
  amount: number;
  billing_interval: "month" | "year";
  interval_count: number;
  environment: "test" | "production";
  is_active: boolean;
  product: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    entitlement_tier: "free" | "player" | "vip";
    is_active: boolean;
  };
};

export async function getActiveVipPrice(admin: SupabaseClient, requireProviderPlan = true) {
  const environment = getBillingEnvironment();
  const { data, error } = await admin
    .from("billing_prices")
    .select("id,product_id,provider,provider_plan_id,currency,amount,billing_interval,interval_count,environment,is_active,product:billing_products!inner(id,code,name,description,entitlement_tier,is_active)")
    .eq("provider", "mercadopago")
    .eq("environment", environment)
    .eq("is_active", true)
    .eq("product.code", "clouva_vip")
    .eq("product.is_active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("CLOUVA VIP todavía no tiene un precio activo para este entorno.");

  const row = data as unknown as BillingPriceRow;
  if (requireProviderPlan && !row.provider_plan_id) {
    throw new Error("El plan de Mercado Pago todavía no fue aprovisionado.");
  }
  return row;
}

export async function provisionVipPlan(admin: SupabaseClient, priceId: string) {
  const environment = getBillingEnvironment();
  const { data, error } = await admin
    .from("billing_prices")
    .select("id,product_id,provider,provider_plan_id,currency,amount,billing_interval,interval_count,environment,is_active,product:billing_products!inner(id,code,name,description,entitlement_tier,is_active)")
    .eq("id", priceId)
    .eq("provider", "mercadopago")
    .eq("environment", environment)
    .eq("product.code", "clouva_vip")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No encontramos ese precio de CLOUVA VIP.");

  const price = data as unknown as BillingPriceRow;
  const provider = new MercadoPagoProvider();
  if (price.provider_plan_id) {
    const existing = await provider.getPlan(price.provider_plan_id);
    return { price, providerPlan: existing, created: false };
  }

  const appBase = process.env.APP_BASE_URL?.trim() || "https://clouva.com.ar";
  const providerPlan = await provider.createPlan({
    reason: price.product.name,
    amount: Number(price.amount),
    currency: price.currency,
    interval: price.billing_interval,
    intervalCount: price.interval_count,
    backUrl: `${appBase}/checkout/vip/return`,
    externalReference: `clouva_vip_price_${price.id}`,
  });
  const providerPlanId = text(providerPlan.id);
  if (!providerPlanId) throw new Error("Mercado Pago no devolvió el ID del plan.");

  const { error: updateError } = await admin
    .from("billing_prices")
    .update({ provider_plan_id: providerPlanId, is_active: true })
    .eq("id", price.id)
    .is("provider_plan_id", null);
  if (updateError) throw new Error(updateError.message);

  await admin.from("billing_products").update({ is_active: true }).eq("id", price.product.id);
  return { price: { ...price, provider_plan_id: providerPlanId, is_active: true }, providerPlan, created: true };
}

export async function createVipSubscription(args: {
  admin: SupabaseClient;
  userId: string;
  payerEmail: string;
  idempotencyKey: string;
}) {
  const environment = getBillingEnvironment();
  const price = await getActiveVipPrice(args.admin, true);
  const { data: existing, error: existingError } = await args.admin
    .from("billing_subscriptions")
    .select("id,status,external_subscription_id,metadata")
    .eq("user_id", args.userId)
    .eq("product_id", price.product.id)
    .eq("environment", environment)
    .in("status", ["created", "pending", "authorized", "active", "past_due", "paused"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) {
    return {
      subscriptionId: existing.id as string,
      status: existing.status as string,
      initPoint: (existing.metadata as Record<string, unknown> | null)?.init_point || null,
      reused: true,
    };
  }

  const externalReference = randomUUID();
  const { data: internal, error: insertError } = await args.admin
    .from("billing_subscriptions")
    .insert({
      user_id: args.userId,
      product_id: price.product.id,
      price_id: price.id,
      provider: "mercadopago",
      environment,
      external_reference: externalReference,
      status: "created",
      metadata: { idempotency_key: args.idempotencyKey },
    })
    .select("id")
    .single();
  if (insertError) throw new Error(insertError.message);

  const appBase = process.env.APP_BASE_URL?.trim() || "https://clouva.com.ar";
  try {
    const providerSubscription = await new MercadoPagoProvider().createSubscription({
      reason: price.product.name,
      amount: Number(price.amount),
      currency: price.currency,
      interval: price.billing_interval,
      intervalCount: price.interval_count,
      payerEmail: args.payerEmail,
      externalReference,
      backUrl: `${appBase}/checkout/vip/return`,
    });
    const externalId = text(providerSubscription.id);
    const initPoint = text(providerSubscription.init_point);
    if (!externalId || !initPoint) throw new Error("Mercado Pago no devolvió la suscripción o el checkout.");

    const providerStatus = text(providerSubscription.status) || "pending";
    const status = mapMercadoPagoSubscriptionStatus(providerStatus);
    const { error: updateError } = await args.admin
      .from("billing_subscriptions")
      .update({
        external_subscription_id: externalId,
        payer_reference: text(providerSubscription.payer_id) || null,
        status,
        provider_status: providerStatus,
        next_payment_at: iso(providerSubscription.next_payment_date),
        last_verified_at: new Date().toISOString(),
        metadata: {
          idempotency_key: args.idempotencyKey,
          init_point: initPoint,
          provider_created_at: providerSubscription.date_created || null,
        },
      })
      .eq("id", internal.id);
    if (updateError) throw new Error(updateError.message);

    return { subscriptionId: internal.id as string, status, initPoint, reused: false };
  } catch (error) {
    await args.admin.from("billing_subscriptions").update({
      status: "error",
      metadata: { idempotency_key: args.idempotencyKey, error: error instanceof Error ? error.message : "unknown" },
    }).eq("id", internal.id);
    throw error;
  }
}

export async function syncProviderSubscription(admin: SupabaseClient, internalId: string) {
  const { data, error } = await admin
    .from("billing_subscriptions")
    .select("*,price:billing_prices(*),product:billing_products(*)")
    .eq("id", internalId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.external_subscription_id) throw new Error("La suscripción interna no tiene ID externo.");

  const providerData = await new MercadoPagoProvider().getSubscription(data.external_subscription_id as string);
  if (text(providerData.external_reference) !== data.external_reference) {
    throw new Error("La referencia externa de la suscripción no coincide.");
  }
  const config = getMercadoPagoConfig(data.environment as "test" | "production");
  if (providerData.application_id && text(providerData.application_id) !== config.applicationId) {
    throw new Error("La suscripción pertenece a otra aplicación de Mercado Pago.");
  }
  if (providerData.collector_id && text(providerData.collector_id) !== config.userId) {
    throw new Error("La suscripción pertenece a otro vendedor de Mercado Pago.");
  }

  const providerStatus = text(providerData.status);
  const mapped = mapMercadoPagoSubscriptionStatus(providerStatus);
  const { error: updateError } = await admin.from("billing_subscriptions").update({
    status: mapped,
    provider_status: providerStatus,
    payer_reference: text(providerData.payer_id) || data.payer_reference,
    next_payment_at: iso(providerData.next_payment_date),
    last_verified_at: new Date().toISOString(),
    cancelled_at: mapped === "cancelled" ? new Date().toISOString() : data.cancelled_at,
  }).eq("id", internalId);
  if (updateError) throw new Error(updateError.message);

  if (mapped === "cancelled" || mapped === "expired") {
    const end = data.current_period_end ? new Date(data.current_period_end as string) : null;
    if (!end || end <= new Date()) {
      await admin.from("user_entitlements").update({
        status: mapped === "expired" ? "expired" : "cancelled",
        expires_at: end?.toISOString() || new Date().toISOString(),
        valid_until: end?.toISOString() || new Date().toISOString(),
        last_verified_at: new Date().toISOString(),
      }).eq("source_subscription_id", internalId).eq("status", "active");
    }
  }

  return { internal: data, provider: providerData, status: mapped };
}

async function activateEntitlement(args: {
  admin: SupabaseClient;
  subscription: Record<string, unknown>;
  product: Record<string, unknown>;
  periodStart: string;
  periodEnd: string;
  paymentId: string;
}) {
  const values = {
    user_id: args.subscription.user_id,
    product_code: args.product.code,
    tier: args.product.entitlement_tier,
    status: "active",
    source: "payment",
    provider: "mercadopago",
    source_provider: "mercadopago",
    source_subscription_id: args.subscription.id,
    external_subscription_id: args.subscription.external_subscription_id,
    starts_at: args.periodStart,
    expires_at: args.periodEnd,
    valid_from: args.periodStart,
    valid_until: args.periodEnd,
    last_verified_at: new Date().toISOString(),
    metadata: { last_payment_id: args.paymentId },
  };

  const { data: existing, error } = await args.admin
    .from("user_entitlements")
    .select("id")
    .eq("user_id", args.subscription.user_id)
    .eq("product_code", args.product.code)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const result = existing
    ? await args.admin.from("user_entitlements").update(values).eq("id", existing.id)
    : await args.admin.from("user_entitlements").insert(values);
  if (result.error) throw new Error(result.error.message);
}

export async function processApprovedPayment(args: {
  admin: SupabaseClient;
  paymentId: string;
  authorizedPaymentId?: string;
  environment: "test" | "production";
}) {
  const provider = new MercadoPagoProvider(getMercadoPagoConfig(args.environment));
  const payment = await provider.getPayment(args.paymentId);
  const config = getMercadoPagoConfig(args.environment);
  if (!isApprovedPayment(payment.status)) {
    return { processed: false, reason: `payment_${text(payment.status) || "unknown"}` };
  }
  if (payment.application_id && text(payment.application_id) !== config.applicationId) {
    throw new Error("El pago pertenece a otra aplicación de Mercado Pago.");
  }
  if (payment.collector_id && text(payment.collector_id) !== config.userId) {
    throw new Error("El pago pertenece a otro vendedor de Mercado Pago.");
  }

  const externalReference = text(payment.external_reference);
  if (!externalReference) throw new Error("El pago no tiene external_reference.");
  const { data: subscription, error } = await args.admin
    .from("billing_subscriptions")
    .select("*,price:billing_prices(*),product:billing_products(*)")
    .eq("external_reference", externalReference)
    .eq("provider", "mercadopago")
    .eq("environment", args.environment)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!subscription) throw new Error("No encontramos la suscripción interna de ese pago.");

  const price = subscription.price as Record<string, unknown>;
  const product = subscription.product as Record<string, unknown>;
  const amount = numberValue(payment.transaction_amount);
  if (!Number.isFinite(amount) || amount !== Number(price.amount)) throw new Error("El importe del pago no coincide con CLOUVA VIP.");
  if (text(payment.currency_id) !== text(price.currency)) throw new Error("La moneda del pago no coincide con CLOUVA VIP.");
  if (text(product.code) !== "clouva_vip") throw new Error("El pago no corresponde a CLOUVA VIP.");

  const { data: existingPayment, error: paymentLookupError } = await args.admin
    .from("billing_payments")
    .select("id")
    .eq("provider", "mercadopago")
    .eq("environment", args.environment)
    .eq("external_payment_id", args.paymentId)
    .maybeSingle();
  if (paymentLookupError) throw new Error(paymentLookupError.message);
  if (existingPayment) return { processed: false, reason: "duplicate_payment" };

  const approvedAt = iso(payment.date_approved) || new Date().toISOString();
  const periodEnd = addBillingInterval(
    new Date(approvedAt),
    text(price.billing_interval),
    Number(price.interval_count) || 1,
  ).toISOString();

  const { error: insertPaymentError } = await args.admin.from("billing_payments").insert({
    user_id: subscription.user_id,
    subscription_id: subscription.id,
    provider: "mercadopago",
    environment: args.environment,
    external_payment_id: args.paymentId,
    external_invoice_id: args.authorizedPaymentId || null,
    external_reference: externalReference,
    amount,
    currency: payment.currency_id,
    status: payment.status,
    status_detail: payment.status_detail || null,
    paid_at: approvedAt,
    metadata: { payment_method_id: payment.payment_method_id || null },
  });
  if (insertPaymentError) throw new Error(insertPaymentError.message);

  const { error: updateSubscriptionError } = await args.admin.from("billing_subscriptions").update({
    status: "active",
    provider_status: "authorized",
    current_period_start: approvedAt,
    current_period_end: periodEnd,
    last_verified_at: new Date().toISOString(),
  }).eq("id", subscription.id);
  if (updateSubscriptionError) throw new Error(updateSubscriptionError.message);

  await activateEntitlement({
    admin: args.admin,
    subscription,
    product,
    periodStart: approvedAt,
    periodEnd,
    paymentId: args.paymentId,
  });

  return { processed: true, subscriptionId: subscription.id, periodEnd };
}

export async function processAuthorizedPayment(args: {
  admin: SupabaseClient;
  authorizedPaymentId: string;
  environment: "test" | "production";
}) {
  const provider = new MercadoPagoProvider(getMercadoPagoConfig(args.environment));
  const invoice = await provider.getAuthorizedPayment(args.authorizedPaymentId);
  const payment = invoice.payment as Record<string, unknown> | undefined;
  const paymentId = text(payment?.id);
  if (!paymentId) return { processed: false, reason: `invoice_${text(invoice.status) || "without_payment"}` };
  return processApprovedPayment({
    admin: args.admin,
    paymentId,
    authorizedPaymentId: args.authorizedPaymentId,
    environment: args.environment,
  });
}
