import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MercadoPagoProvider } from "./providers/mercadopago/client";
import { getMercadoPagoConfig } from "./providers/mercadopago/config";
import { mapMercadoPagoSubscriptionStatus } from "./providers/mercadopago/mapper";
import { verifyMercadoPagoSignature } from "./providers/mercadopago/signature";
import { processApprovedPayment, processAuthorizedPayment } from "./service";

export type MercadoPagoWebhookEnvironment = "test" | "production";

type WebhookBody = {
  id?: string | number;
  type?: string;
  topic?: string;
  action?: string;
  data?: { id?: string | number };
};

function text(value: unknown) {
  return value == null ? "" : String(value);
}

function topicOf(body: WebhookBody) {
  return text(body.type || body.topic).toLowerCase();
}

function resourceIdOf(request: NextRequest, body: WebhookBody) {
  return text(
    body.data?.id ||
      request.nextUrl.searchParams.get("data.id") ||
      request.nextUrl.searchParams.get("id"),
  );
}

async function findInternalSubscription(admin: SupabaseClient, environment: MercadoPagoWebhookEnvironment, providerSubscription: Record<string, unknown>) {
  const externalId = text(providerSubscription.id);
  const externalReference = text(providerSubscription.external_reference);
  let query = admin
    .from("billing_subscriptions")
    .select("id,environment,external_subscription_id,external_reference,status")
    .eq("provider", "mercadopago")
    .eq("environment", environment);

  if (externalId) query = query.eq("external_subscription_id", externalId);
  else if (externalReference) query = query.eq("external_reference", externalReference);
  else throw new Error("La suscripción de Mercado Pago no tiene referencia verificable.");

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("No encontramos la suscripción interna notificada.");
  if (externalReference && data.external_reference !== externalReference) {
    throw new Error("La referencia externa de la suscripción no coincide.");
  }
  return data;
}

async function syncSubscriptionEvent(args: {
  admin: SupabaseClient;
  environment: MercadoPagoWebhookEnvironment;
  resourceId: string;
}) {
  const config = getMercadoPagoConfig(args.environment);
  const provider = new MercadoPagoProvider(config);
  const providerSubscription = await provider.getSubscription(args.resourceId);

  if (providerSubscription.application_id && text(providerSubscription.application_id) !== config.applicationId) {
    throw new Error("La suscripción notificada pertenece a otra aplicación.");
  }
  if (providerSubscription.collector_id && text(providerSubscription.collector_id) !== config.userId) {
    throw new Error("La suscripción notificada pertenece a otro vendedor.");
  }

  const internal = await findInternalSubscription(args.admin, args.environment, providerSubscription);
  const providerStatus = text(providerSubscription.status);
  const status = mapMercadoPagoSubscriptionStatus(providerStatus);
  const now = new Date().toISOString();
  const { error } = await args.admin
    .from("billing_subscriptions")
    .update({
      status,
      provider_status: providerStatus,
      payer_reference: text(providerSubscription.payer_id) || null,
      next_payment_at: providerSubscription.next_payment_date || null,
      last_verified_at: now,
      cancelled_at: status === "cancelled" ? now : null,
    })
    .eq("id", internal.id);
  if (error) throw new Error(error.message);

  if (status === "cancelled" || status === "expired") {
    const { data: subscription } = await args.admin
      .from("billing_subscriptions")
      .select("current_period_end")
      .eq("id", internal.id)
      .single();
    const end = subscription?.current_period_end ? new Date(subscription.current_period_end) : null;
    if (!end || end <= new Date()) {
      await args.admin
        .from("user_entitlements")
        .update({
          status: status === "expired" ? "expired" : "cancelled",
          valid_until: end?.toISOString() || now,
          expires_at: end?.toISOString() || now,
          last_verified_at: now,
        })
        .eq("source_subscription_id", internal.id)
        .eq("status", "active");
    }
  }

  return { processed: true, subscriptionId: internal.id, status };
}

export async function handleMercadoPagoWebhook(args: {
  request: NextRequest;
  admin: SupabaseClient;
  environment: MercadoPagoWebhookEnvironment;
}) {
  const body = (await args.request.json().catch(() => ({}))) as WebhookBody;
  const topic = topicOf(body);
  const resourceId = resourceIdOf(args.request, body);
  const requestId = args.request.headers.get("x-request-id") || "";
  const signatureHeader = args.request.headers.get("x-signature") || "";
  const config = getMercadoPagoConfig(args.environment);

  if (!topic || !resourceId) throw new Error("La notificación no contiene tipo o recurso.");
  if (!verifyMercadoPagoSignature({
    xSignature: signatureHeader,
    xRequestId: requestId,
    dataId: resourceId,
    secret: config.webhookSecret,
  })) {
    const error = new Error("Firma de Mercado Pago inválida.");
    (error as Error & { status?: number }).status = 401;
    throw error;
  }

  const providerEventId = text(body.id) || null;
  let duplicateQuery = args.admin
    .from("billing_webhook_events")
    .select("id,processing_status")
    .eq("provider", "mercadopago")
    .eq("environment", args.environment);
  duplicateQuery = providerEventId
    ? duplicateQuery.eq("provider_event_id", providerEventId)
    : duplicateQuery.eq("request_id", requestId).eq("event_type", topic).eq("resource_id", resourceId);
  const { data: duplicate, error: duplicateError } = await duplicateQuery.maybeSingle();
  if (duplicateError) throw new Error(duplicateError.message);
  if (duplicate?.processing_status === "processed" || duplicate?.processing_status === "ignored") {
    return { duplicate: true, processed: true };
  }

  let eventId = duplicate?.id as string | undefined;
  if (!eventId) {
    const { data, error } = await args.admin
      .from("billing_webhook_events")
      .insert({
        provider: "mercadopago",
        environment: args.environment,
        provider_event_id: providerEventId,
        request_id: requestId || null,
        event_type: topic,
        resource_id: resourceId,
        payload: {
          id: body.id || null,
          type: body.type || body.topic || null,
          action: body.action || null,
          data: { id: resourceId },
        },
        signature_valid: true,
        processing_status: "received",
        attempts: 0,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventId = data.id as string;
  }

  await args.admin
    .from("billing_webhook_events")
    .update({ processing_status: "processing", attempts: (Number(duplicate?.attempts) || 0) + 1 })
    .eq("id", eventId);

  try {
    let result: Record<string, unknown>;
    if (topic === "subscription_authorized_payment") {
      result = await processAuthorizedPayment({
        admin: args.admin,
        authorizedPaymentId: resourceId,
        environment: args.environment,
      });
    } else if (topic === "payment") {
      result = await processApprovedPayment({
        admin: args.admin,
        paymentId: resourceId,
        environment: args.environment,
      });
    } else if (topic === "subscription_preapproval") {
      result = await syncSubscriptionEvent({
        admin: args.admin,
        environment: args.environment,
        resourceId,
      });
    } else {
      result = { processed: false, ignored: true, topic };
    }

    await args.admin
      .from("billing_webhook_events")
      .update({
        processing_status: result.ignored ? "ignored" : "processed",
        processed_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", eventId);
    return result;
  } catch (error) {
    await args.admin
      .from("billing_webhook_events")
      .update({
        processing_status: "failed",
        error: error instanceof Error ? error.message.slice(0, 1000) : "unknown",
      })
      .eq("id", eventId);
    throw error;
  }
}
