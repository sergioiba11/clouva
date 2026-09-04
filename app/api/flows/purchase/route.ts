import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { isBillingEnabled } from "@/core/billing/providers/mercadopago/config";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let operationId: string | null = null;
  try {
    if (!isBillingEnabled()) {
      return NextResponse.json({ error: "Los pagos todavía no están habilitados." }, { status: 503 });
    }

    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { quantity?: unknown; recipientPlayerId?: unknown };
    const quantity = Math.max(1, Math.min(50, Math.trunc(Number(body.quantity) || 1)));
    const recipientPlayerId = typeof body.recipientPlayerId === "string" ? body.recipientPlayerId.trim() : "";
    const admin = createAdminSupabase();

    const [{ data: pricing, error: pricingError }, { data: buyerPlayer, error: buyerError }] = await Promise.all([
      admin.from("flow_issuance_settings").select("flow_usd_value").eq("id", "canonical").single(),
      admin
        .from("players")
        .select("id,owner_user_id,display_name,slug")
        .eq("owner_user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (pricingError) throw new Error(pricingError.message);
    if (buyerError) throw new Error(buyerError.message);

    const unitUsd = Number(pricing.flow_usd_value);
    if (!Number.isFinite(unitUsd) || unitUsd <= 0) throw new Error("La configuración canónica de FLOW es inválida.");

    let recipient = buyerPlayer;
    if (recipientPlayerId) {
      const result = await admin
        .from("players")
        .select("id,owner_user_id,display_name,slug")
        .eq("id", recipientPlayerId)
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      recipient = result.data;
    }
    if (!recipient?.owner_user_id) {
      return NextResponse.json({ error: "El Player receptor debe tener una cuenta CLOUVA vinculada." }, { status: 422 });
    }

    const externalReference = `flow:${randomUUID()}`;
    const amount = quantity * unitUsd;
    const { data: operation, error: operationError } = await admin
      .from("flow_purchase_operations")
      .insert({
        buyer_user_id: user.id,
        buyer_player_id: buyerPlayer?.id ?? null,
        recipient_user_id: recipient.owner_user_id,
        recipient_player_id: recipient.id,
        provider: "mercadopago",
        provider_reference: externalReference,
        payment_method: "mercadopago",
        quantity,
        unit_usd: unitUsd,
        amount,
        currency: "USD",
        status: "pending",
        backing_status: "pending",
        created_by: user.id,
        metadata: { recipientSlug: recipient.slug, recipientName: recipient.display_name },
      })
      .select("id")
      .single();
    if (operationError) throw new Error(operationError.message);
    operationId = operation.id;

    const appBase = (process.env.APP_BASE_URL?.trim() || "https://clouva.com.ar").replace(/\/$/, "");
    const returnUrl = `${appBase}/mi-flow/billetera/flows?operation=${encodeURIComponent(operation.id)}`;
    const preference = await new MercadoPagoProvider().createPreference({
      items: [{ title: quantity === 1 ? "CLOUVA FLOW" : `CLOUVA FLOWS × ${quantity}`, quantity, unitPrice: unitUsd, currency: "USD" }],
      payer: user.email ? { email: user.email } : undefined,
      externalReference,
      backUrls: {
        success: `${returnUrl}&return=success`,
        failure: `${returnUrl}&return=failure`,
        pending: `${returnUrl}&return=pending`,
      },
      notificationUrl: `${appBase}/api/webhooks/mercadopago/flows`,
    });
    const initPoint = typeof preference.init_point === "string" ? preference.init_point : null;
    if (!initPoint) throw new Error("Mercado Pago no devolvió el checkout.");

    return NextResponse.json({ operationId: operation.id, quantity, unitUsd, amount, currency: "USD", initPoint });
  } catch (error) {
    if (operationId) {
      const admin = createAdminSupabase();
      await admin
        .from("flow_purchase_operations")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", operationId)
        .eq("status", "pending");
    }
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo iniciar la compra de FLOWS.";
    console.error("flow_purchase_checkout_failed", { operationId, message });
    return NextResponse.json({ error: message }, { status });
  }
}
