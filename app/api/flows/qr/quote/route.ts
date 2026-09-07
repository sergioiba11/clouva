import { NextRequest, NextResponse } from "next/server";
import { formatFlowUnits, parseDecimalToUnits, quoteLocalAmountToFlowUnits } from "@/core/flows/money/units";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { getFlowCheckoutQuote } from "@/lib/server/flow-pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanAmount(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim().replace(",", ".");
  try {
    const cents = parseDecimalToUnits(text, 2, "exact");
    if (cents <= 0n || cents > 1_000_000_000n) return null;
    return text;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { operationId?: unknown; merchantAmount?: unknown };
    const operationId = typeof body.operationId === "string" ? body.operationId.trim() : "";
    if (!UUID_RE.test(operationId)) return NextResponse.json({ error: "Operación QR inválida." }, { status: 400 });

    const admin = createAdminSupabase();
    const { data: operation, error } = await admin
      .from("flow_qr_payment_operations")
      .select("id,user_id,status,capability,merchant_amount,merchant_currency,amount_editable,merchant_name,flow_units,provider_fee_units,clouva_fee_units,total_flow_units,fx_pair,fx_rate,fx_source,fx_quoted_at,quote_expires_at,reference_usd")
      .eq("id", operationId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!operation) return NextResponse.json({ error: "Operación QR inexistente." }, { status: 404 });

    if (operation.status === "quoted" && operation.quote_expires_at && Date.parse(operation.quote_expires_at) > Date.now()) {
      return NextResponse.json({
        quote: {
          operationId: operation.id,
          merchantAmount: String(operation.merchant_amount),
          merchantCurrency: operation.merchant_currency,
          referenceUsd: String(operation.reference_usd),
          flowUnits: String(operation.flow_units),
          flowAmount: formatFlowUnits(String(operation.flow_units)),
          providerFeeUnits: String(operation.provider_fee_units),
          clouvaFeeUnits: String(operation.clouva_fee_units),
          totalFlowUnits: String(operation.total_flow_units),
          totalFlow: formatFlowUnits(String(operation.total_flow_units)),
          fxPair: operation.fx_pair,
          fxRate: String(operation.fx_rate),
          fxSource: operation.fx_source,
          quotedAt: operation.fx_quoted_at,
          expiresAt: operation.quote_expires_at,
        },
        reused: true,
      });
    }

    if (operation.status !== "resolved" && operation.status !== "quoted") {
      return NextResponse.json({ error: "La operación QR ya avanzó y no admite una nueva cotización." }, { status: 409 });
    }
    if (operation.capability !== "PAYABLE") {
      return NextResponse.json({
        error: "El QR fue reconocido, pero CLOUVA todavía no tiene un rail autorizado para pagarlo.",
        code: "QR_NOT_AUTHORIZED",
      }, { status: 409 });
    }
    if (operation.merchant_currency !== "ARS") {
      return NextResponse.json({ error: "Pagar QR está habilitado inicialmente solo para obligaciones ARS." }, { status: 422 });
    }

    const fixedAmount = operation.merchant_amount != null ? String(operation.merchant_amount) : null;
    const requestedAmount = cleanAmount(body.merchantAmount);
    let merchantAmount: string;
    if (fixedAmount && !operation.amount_editable) {
      if (requestedAmount && parseDecimalToUnits(requestedAmount, 2) !== parseDecimalToUnits(fixedAmount, 2)) {
        return NextResponse.json({ error: "El monto fue definido por el comercio y no puede modificarse." }, { status: 409 });
      }
      merchantAmount = fixedAmount;
    } else {
      if (!requestedAmount) return NextResponse.json({ error: "Ingresá el monto indicado por el comercio." }, { status: 400 });
      merchantAmount = requestedAmount;
    }

    const fx = await getFlowCheckoutQuote();
    const fxRate = String(fx.fxRateOriginalPerUsd);
    const flowUnits = quoteLocalAmountToFlowUnits(merchantAmount, fxRate);
    const providerFeeUnits = 0n;
    const clouvaFeeUnits = 0n;
    const totalFlowUnits = flowUnits + providerFeeUnits + clouvaFeeUnits;
    const quotedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const referenceUsd = formatFlowUnits(flowUnits);

    const { error: updateError } = await admin.from("flow_qr_payment_operations").update({
      merchant_amount: merchantAmount,
      merchant_currency: "ARS",
      status: "quoted",
      fx_pair: fx.fxPair,
      fx_rate: fxRate,
      fx_source: fx.fxSource,
      fx_quoted_at: quotedAt,
      quote_expires_at: expiresAt,
      reference_usd: referenceUsd,
      flow_units: flowUnits.toString(),
      provider_fee_units: providerFeeUnits.toString(),
      clouva_fee_units: clouvaFeeUnits.toString(),
      total_flow_units: totalFlowUnits.toString(),
      updated_at: quotedAt,
    }).eq("id", operation.id).eq("user_id", user.id);
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({
      quote: {
        operationId: operation.id,
        merchantAmount,
        merchantCurrency: "ARS",
        referenceUsd,
        flowUnits: flowUnits.toString(),
        flowAmount: formatFlowUnits(flowUnits),
        providerFeeUnits: providerFeeUnits.toString(),
        clouvaFeeUnits: clouvaFeeUnits.toString(),
        totalFlowUnits: totalFlowUnits.toString(),
        totalFlow: formatFlowUnits(totalFlowUnits),
        fxPair: fx.fxPair,
        fxRate,
        fxSource: fx.fxSource,
        quotedAt,
        expiresAt,
      },
      merchant: operation.merchant_name,
      reused: false,
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cotizar el pago QR." }, { status });
  }
}
