import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { getMercadoPagoConfig, isBillingEnabled } from "@/core/billing/providers/mercadopago/config";
import { getFlowCheckoutQuote, roundMoney } from "@/lib/server/flow-pricing";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlayerRow = {
  id: string;
  owner_user_id: string | null;
  display_name: string | null;
  slug: string | null;
};

type ProcessingFeePolicy = "clouva_absorbs" | "customer_buffer";

function checkoutFromMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).checkoutInitPoint;
  return typeof value === "string" && value.startsWith("https://") ? value : null;
}

function positiveNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function POST(request: NextRequest) {
  let operationId: string | null = null;
  try {
    if (!isBillingEnabled()) {
      return NextResponse.json({ error: "Los pagos todavía no están habilitados." }, { status: 503 });
    }

    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      quantity?: unknown;
      recipientPlayerId?: unknown;
      backExistingAssetId?: unknown;
    };
    const requestedQuantity = Math.max(1, Math.min(50, Math.trunc(Number(body.quantity) || 1)));
    const recipientPlayerId = typeof body.recipientPlayerId === "string" ? body.recipientPlayerId.trim() : "";
    const backExistingAssetId = typeof body.backExistingAssetId === "string" ? body.backExistingAssetId.trim() : "";
    const admin = createAdminSupabase();
    const mpConfig = getMercadoPagoConfig();

    const [
      { data: pricing, error: pricingError },
      { data: buyerPlayer, error: buyerError },
      { data: reserveAccount, error: reserveError },
    ] = await Promise.all([
      admin
        .from("flow_issuance_settings")
        .select("flow_usd_value,processing_fee_policy,processing_fee_bps,processing_fee_fixed_usd")
        .eq("id", "canonical")
        .single(),
      admin
        .from("players")
        .select("id,owner_user_id,display_name,slug")
        .eq("owner_user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("flow_reserve_accounts")
        .select("id")
        .eq("provider", "mercadopago")
        .eq("currency", "ARS")
        .eq("account_reference", mpConfig.userId)
        .eq("authorized_for_flow", true)
        .eq("is_active", true)
        .eq("status", "active")
        .maybeSingle(),
    ]);
    if (pricingError) throw new Error(pricingError.message);
    if (buyerError) throw new Error(buyerError.message);
    if (reserveError) throw new Error(reserveError.message);
    if (!reserveAccount) {
      return NextResponse.json(
        { error: "La Cuenta de Reserva FLOW de Mercado Pago todavía no está autorizada. No se puede recibir dinero hasta completar esa validación." },
        { status: 503 },
      );
    }

    const unitUsd = Number(pricing.flow_usd_value);
    if (!Number.isFinite(unitUsd) || unitUsd <= 0) throw new Error("La configuración canónica de FLOW es inválida.");
    const processingFeePolicy = pricing.processing_fee_policy as ProcessingFeePolicy;
    if (processingFeePolicy !== "clouva_absorbs" && processingFeePolicy !== "customer_buffer") {
      throw new Error("La política de procesamiento FLOW es inválida.");
    }
    const processingFeeBps = positiveNumber(pricing.processing_fee_bps);
    const processingFeeFixedUsd = positiveNumber(pricing.processing_fee_fixed_usd);

    let quantity = requestedQuantity;
    let recipient = buyerPlayer as PlayerRow | null;
    let operationType: "purchase_new" | "back_existing" = "purchase_new";
    let targetAssetId: string | null = null;
    let title: string;

    if (backExistingAssetId) {
      const { data: asset, error: assetError } = await admin
        .from("flow_assets")
        .select("id,flow_number,status,owner_user_id,owner_player_id,backing_operation_id")
        .eq("id", backExistingAssetId)
        .eq("owner_user_id", user.id)
        .maybeSingle();
      if (assetError) throw new Error(assetError.message);
      if (!asset) return NextResponse.json({ error: "Ese FLOW no pertenece a tu billetera." }, { status: 404 });
      if (asset.status !== "legacy_unverified" || asset.backing_operation_id) {
        return NextResponse.json({ error: "Ese FLOW ya está respaldado o no admite un nuevo respaldo." }, { status: 409 });
      }
      if (!asset.owner_player_id) {
        return NextResponse.json({ error: "El FLOW debe estar asociado a un Player antes de respaldarlo." }, { status: 422 });
      }

      const [{ data: ownerPlayer, error: ownerError }, { data: activeBacking, error: activeError }] = await Promise.all([
        admin.from("players").select("id,owner_user_id,display_name,slug").eq("id", asset.owner_player_id).maybeSingle(),
        admin
          .from("flow_purchase_operations")
          .select("id,status,amount,currency,required_backing_usd,backing_amount,processing_fee_amount,processing_fee_policy,metadata")
          .eq("operation_type", "back_existing")
          .eq("target_asset_id", asset.id)
          .in("status", ["pending", "confirmed"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (ownerError) throw new Error(ownerError.message);
      if (activeError) throw new Error(activeError.message);
      if (!ownerPlayer?.owner_user_id || ownerPlayer.owner_user_id !== user.id) {
        return NextResponse.json({ error: "El Player propietario del FLOW no coincide con tu cuenta." }, { status: 403 });
      }
      if (activeBacking) {
        const existingCheckout = checkoutFromMetadata(activeBacking.metadata);
        if (activeBacking.status === "pending" && existingCheckout) {
          return NextResponse.json({
            operationId: activeBacking.id,
            quantity: 1,
            unitUsd,
            amount: Number(activeBacking.amount),
            backingAmount: Number(activeBacking.backing_amount),
            requiredBackingUsd: Number(activeBacking.required_backing_usd),
            processingFeeAmount: Number(activeBacking.processing_fee_amount),
            processingFeePolicy: activeBacking.processing_fee_policy,
            currency: activeBacking.currency,
            initPoint: existingCheckout,
            reused: true,
            operationType: "back_existing",
          });
        }
        return NextResponse.json({ error: "Ese FLOW ya tiene una operación de respaldo en curso." }, { status: 409 });
      }

      quantity = 1;
      recipient = ownerPlayer as PlayerRow;
      operationType = "back_existing";
      targetAssetId = asset.id;
      title = `Respaldo CLOUVA FLOW #${String(asset.flow_number).padStart(6, "0")}`;
    } else {
      if (recipientPlayerId) {
        const result = await admin
          .from("players")
          .select("id,owner_user_id,display_name,slug")
          .eq("id", recipientPlayerId)
          .maybeSingle();
        if (result.error) throw new Error(result.error.message);
        recipient = result.data as PlayerRow | null;
      }
      if (!recipient?.owner_user_id) {
        return NextResponse.json({ error: "El Player receptor debe tener una cuenta CLOUVA vinculada." }, { status: 422 });
      }
      title = quantity === 1 ? "CLOUVA FLOW" : `CLOUVA FLOWS × ${quantity}`;
    }

    if (!recipient?.owner_user_id) {
      return NextResponse.json({ error: "El Player receptor debe tener una cuenta CLOUVA vinculada." }, { status: 422 });
    }

    const quote = await getFlowCheckoutQuote();
    const requiredBackingUsd = roundMoney(unitUsd * quantity);
    const checkoutUnitAmount = roundMoney(unitUsd * quote.fxRateOriginalPerUsd);
    const backingAmount = roundMoney(requiredBackingUsd * quote.fxRateOriginalPerUsd);
    const processingFeeUsd = processingFeePolicy === "customer_buffer"
      ? roundMoney((requiredBackingUsd * processingFeeBps) / 10_000 + processingFeeFixedUsd)
      : 0;
    const processingFeeAmount = processingFeePolicy === "customer_buffer"
      ? roundMoney(processingFeeUsd * quote.fxRateOriginalPerUsd)
      : 0;
    const amount = roundMoney(backingAmount + processingFeeAmount);
    const externalReference = `flow:${randomUUID()}`;
    const initialMetadata = {
      recipientSlug: recipient.slug,
      recipientName: recipient.display_name,
      flowUsdUnitValue: unitUsd,
      requiredBackingUsd,
      checkoutUnitAmount,
      backingAmount,
      processingFeeAmount,
      processingFeeUsd,
      processingFeePolicy,
      processingFeeBps,
      processingFeeFixedUsd,
      quoteSourceDate: quote.sourceDate,
      operationType,
      targetAssetId,
      reserveAccountId: reserveAccount.id,
      reserveCollectorId: mpConfig.userId,
    };

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
        backing_amount: backingAmount,
        required_backing_usd: requiredBackingUsd,
        processing_fee_amount: processingFeeAmount,
        processing_fee_policy: processingFeePolicy,
        currency: quote.checkoutCurrency,
        status: "pending",
        backing_status: "pending",
        operation_type: operationType,
        target_asset_id: targetAssetId,
        fx_rate_original_per_usd: quote.fxRateOriginalPerUsd,
        fx_pair: quote.fxPair,
        fx_source: quote.fxSource,
        fx_quoted_at: quote.fxQuotedAt,
        provider_fee: 0,
        net_amount: null,
        created_by: user.id,
        metadata: initialMetadata,
      })
      .select("id")
      .single();
    if (operationError) throw new Error(operationError.message);
    operationId = operation.id;

    const appBase = (process.env.APP_BASE_URL?.trim() || "https://clouva.com.ar").replace(/\/$/, "");
    const returnUrl = `${appBase}/mi-flow/billetera/flows?operation=${encodeURIComponent(operation.id)}`;
    const items = [
      { title, quantity: 1, unitPrice: backingAmount, currency: quote.checkoutCurrency },
      ...(processingFeeAmount > 0
        ? [{ title: "Procesamiento de pago FLOW", quantity: 1, unitPrice: processingFeeAmount, currency: quote.checkoutCurrency }]
        : []),
    ];
    const preference = await new MercadoPagoProvider(mpConfig).createPreference({
      items,
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

    const checkoutPreferenceId = typeof preference.id === "string" || typeof preference.id === "number" ? String(preference.id) : null;
    const { error: metadataError } = await admin
      .from("flow_purchase_operations")
      .update({
        metadata: { ...initialMetadata, checkoutPreferenceId, checkoutInitPoint: initPoint },
        updated_at: new Date().toISOString(),
      })
      .eq("id", operation.id)
      .eq("status", "pending");
    if (metadataError) console.error("flow_purchase_metadata_update_failed", { operationId: operation.id, message: metadataError.message });

    return NextResponse.json({
      operationId: operation.id,
      operationType,
      targetAssetId,
      quantity,
      unitUsd,
      requiredBackingUsd,
      backingAmount,
      processingFeeAmount,
      processingFeePolicy,
      amount,
      currency: quote.checkoutCurrency,
      fxRate: quote.fxRateOriginalPerUsd,
      fxPair: quote.fxPair,
      fxSource: quote.fxSource,
      fxQuotedAt: quote.fxQuotedAt,
      initPoint,
    });
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
