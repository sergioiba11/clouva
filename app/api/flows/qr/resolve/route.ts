import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { classifyParsedQr, parseUniversalQr } from "@/core/flows/qr/parse";
import { hashQrPayload, mercadoPagoInteroperableResolverEnabled, universalQrSandboxEnabled } from "@/core/flows/qr/server";
import { UniversalQrSandboxProvider } from "@/core/flows/payments/providers/sandbox/merchant-qr";
import { resolveMercadoPagoInteroperableQr } from "@/core/flows/payments/providers/mercadopago/interoperable-qr";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function storageResolution(value: Record<string, unknown>) {
  const { raw: _raw, ...rest } = value;
  return rest;
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { rawQr?: unknown };
    const rawQr = typeof body.rawQr === "string" ? body.rawQr.trim() : "";
    if (!rawQr || rawQr.length > 4096) return NextResponse.json({ error: "El QR está vacío o es demasiado largo." }, { status: 400 });

    const parsed = parseUniversalQr(rawQr);
    if (parsed.type === "clouva") {
      return NextResponse.json({
        kind: "clouva",
        resolution: classifyParsedQr(parsed),
        safeMessage: "Este es un QR CLOUVA y debe continuar por el flujo interno FLOW→FLOW o Commerce.",
      });
    }

    let resolution = classifyParsedQr(parsed, {
      sandboxEnabled: universalQrSandboxEnabled(),
      mercadopagoResolverEnabled: mercadoPagoInteroperableResolverEnabled(),
    });

    if (parsed.type === "sandbox_merchant" && universalQrSandboxEnabled()) {
      resolution = await new UniversalQrSandboxProvider().resolveQr(rawQr);
    } else if (
      (parsed.type === "mercadopago" || parsed.type === "argentina_interoperable" || parsed.type === "merchant_emv") &&
      mercadoPagoInteroperableResolverEnabled()
    ) {
      resolution = await resolveMercadoPagoInteroperableQr(rawQr);
    }

    const admin = createAdminSupabase();
    const { data: player, error: playerError } = await admin
      .from("players")
      .select("id")
      .eq("owner_user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (playerError) throw new Error(playerError.message);
    if (!player) return NextResponse.json({ error: "Necesitás un Player CLOUVA para usar Pagar QR." }, { status: 422 });

    const operationId = randomUUID();
    const merchant = resolution.merchant ?? null;
    const payloadHash = hashQrPayload(rawQr);
    const { error: insertError } = await admin.from("flow_qr_payment_operations").insert({
      id: operationId,
      user_id: user.id,
      player_id: player.id,
      raw_qr: rawQr,
      qr_payload_hash: payloadHash,
      qr_type: resolution.type,
      provider: resolution.provider ?? resolution.providerHint ?? null,
      administrator: resolution.administrator ?? null,
      merchant_name: merchant?.name ?? null,
      merchant_id: merchant?.merchantId ?? null,
      merchant_city: merchant?.city ?? null,
      merchant_mcc: merchant?.mcc ?? null,
      merchant_amount: resolution.amount ?? null,
      merchant_currency: resolution.currency ?? null,
      qr_transaction_id: resolution.transactionId ?? null,
      provider_order_id: resolution.orderId ?? null,
      dynamic_qr: resolution.dynamic ?? null,
      amount_editable: resolution.amountEditable,
      capability: resolution.capability,
      resolution: storageResolution(resolution as unknown as Record<string, unknown>),
      status: "resolved",
      rail_provider: resolution.capability === "PAYABLE" ? resolution.provider : null,
      rail_method: resolution.capability === "PAYABLE" ? "merchant_qr" : null,
      sandbox: resolution.provider === "sandbox",
    });
    if (insertError) throw new Error(insertError.message);

    return NextResponse.json({
      operationId,
      qrPayloadHash: payloadHash,
      resolution: storageResolution(resolution as unknown as Record<string, unknown>),
    }, { status: 201 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo resolver el QR." }, { status });
  }
}
