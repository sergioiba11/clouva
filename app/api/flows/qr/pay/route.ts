import { NextRequest, NextResponse } from "next/server";
import { UniversalQrSandboxProvider } from "@/core/flows/payments/providers/sandbox/merchant-qr";
import type { UniversalQrResolution } from "@/core/flows/qr/types";
import { universalQrSandboxEnabled } from "@/core/flows/qr/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asResolution(value: unknown): UniversalQrResolution {
  return (value && typeof value === "object" ? value : {}) as UniversalQrResolution;
}

function statusForMessage(message: string) {
  if (/Saldo FLOW|reconciliad|backing|respalda|custodia/i.test(message)) return 409;
  if (/venció|expir/i.test(message)) return 409;
  if (/inválid|no coincide|no admite|no tiene un rail/i.test(message)) return 400;
  return 500;
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { operationId?: unknown };
    const operationId = typeof body.operationId === "string" ? body.operationId.trim() : "";
    if (!UUID_RE.test(operationId)) return NextResponse.json({ error: "Operación QR inválida." }, { status: 400 });

    const admin = createAdminSupabase();
    const { data: operation, error } = await admin
      .from("flow_qr_payment_operations")
      .select("id,user_id,status,provider,raw_qr,resolution,merchant_amount,merchant_currency,total_flow_units,provider_payment_id,provider_status,sandbox,capability,confirmed_at,last_error_code,last_safe_message")
      .eq("id", operationId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!operation) return NextResponse.json({ error: "Operación QR inexistente." }, { status: 404 });

    if (operation.status === "payment_confirmed") {
      return NextResponse.json({ operationId, status: operation.status, providerPaymentId: operation.provider_payment_id, recovered: true });
    }
    if (["failed", "expired", "reversed"].includes(operation.status)) {
      return NextResponse.json({ error: operation.last_safe_message || `La operación quedó ${operation.status}.`, code: operation.last_error_code || operation.status }, { status: 409 });
    }
    if (operation.capability !== "PAYABLE") {
      return NextResponse.json({ error: "El QR todavía no tiene un rail autorizado para ejecutar el pago.", code: "QR_NOT_AUTHORIZED" }, { status: 409 });
    }
    if (!operation.total_flow_units || !operation.merchant_amount || !operation.merchant_currency) {
      return NextResponse.json({ error: "Primero cotizá el pago QR." }, { status: 409 });
    }

    if (operation.status === "quoted") {
      const { error: holdError } = await admin.rpc("hold_flow_qr_payment", {
        p_operation_id: operation.id,
        p_user_id: user.id,
        p_total_flow_units: String(operation.total_flow_units),
        p_actor_id: user.id,
      });
      if (holdError) return NextResponse.json({ error: holdError.message }, { status: statusForMessage(holdError.message) });
    }

    const { data: current, error: currentError } = await admin
      .from("flow_qr_payment_operations")
      .select("id,status,provider,raw_qr,resolution,merchant_amount,merchant_currency,total_flow_units,provider_payment_id,provider_status,sandbox")
      .eq("id", operation.id)
      .eq("user_id", user.id)
      .single();
    if (currentError) throw new Error(currentError.message);

    if (current.status === "payment_pending" || current.status === "payment_submitted") {
      return NextResponse.json({
        operationId: current.id,
        status: current.status,
        providerPaymentId: current.provider_payment_id,
        providerStatus: current.provider_status,
        recovered: true,
      });
    }
    if (current.status !== "flow_held") {
      return NextResponse.json({ error: `Estado QR inesperado: ${current.status}.` }, { status: 409 });
    }

    if (current.provider !== "sandbox" || !current.sandbox) {
      // Real merchant rails remain disabled until CLOUVA has a homologated PCT/COELSA provider.
      const { error: releaseError } = await admin.rpc("release_flow_qr_payment", {
        p_operation_id: current.id,
        p_user_id: user.id,
        p_actor_id: user.id,
        p_final_status: "failed",
        p_error_code: "merchant_rail_not_authorized",
        p_safe_message: "El QR fue reconocido, pero el rail real todavía no está homologado. Tus FLOW fueron liberados.",
      });
      if (releaseError) throw new Error(releaseError.message);
      return NextResponse.json({ error: "El rail merchant QR real todavía no está autorizado. Tus FLOW fueron liberados.", code: "QR_NOT_AUTHORIZED" }, { status: 409 });
    }
    if (!universalQrSandboxEnabled()) {
      return NextResponse.json({ error: "El sandbox Universal QR está deshabilitado." }, { status: 503 });
    }

    const provider = new UniversalQrSandboxProvider();
    let payment;
    try {
      payment = await provider.createPayment({
        operationId: current.id,
        idempotencyKey: current.id,
        rawQr: current.raw_qr,
        resolution: asResolution(current.resolution),
        merchantAmount: String(current.merchant_amount),
        currency: current.merchant_currency,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Provider timeout";
      if (/TIMEOUT/i.test(message)) {
        await admin.from("flow_qr_payment_operations").update({
          status: "payment_submitted",
          provider_status: "UNKNOWN",
          last_error_code: "provider_timeout_unknown",
          last_safe_message: "El provider no respondió. Los FLOW siguen retenidos mientras se reconcilia el pago.",
          submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", current.id).eq("user_id", user.id);
        return NextResponse.json({ operationId: current.id, status: "payment_submitted", code: "PROVIDER_TIMEOUT_UNKNOWN", message: "El pago quedó en verificación; no se volvió a enviar ni se liberaron los FLOW." }, { status: 202 });
      }
      const { error: releaseError } = await admin.rpc("release_flow_qr_payment", {
        p_operation_id: current.id,
        p_user_id: user.id,
        p_actor_id: user.id,
        p_final_status: "failed",
        p_error_code: "provider_create_failed",
        p_safe_message: "El proveedor rechazó iniciar el pago. Tus FLOW fueron liberados.",
      });
      if (releaseError) throw new Error(releaseError.message);
      throw cause;
    }

    if (payment.status === "FAILED" || payment.status === "CANCELLED" || payment.status === "EXPIRED") {
      const { data: released, error: releaseError } = await admin.rpc("release_flow_qr_payment", {
        p_operation_id: current.id,
        p_user_id: user.id,
        p_actor_id: user.id,
        p_final_status: payment.status === "EXPIRED" ? "expired" : "failed",
        p_error_code: `provider_${payment.status.toLowerCase()}`,
        p_safe_message: "El pago no se completó. Tus FLOW fueron liberados.",
      });
      if (releaseError) throw new Error(releaseError.message);
      return NextResponse.json({ operationId: current.id, status: payment.status.toLowerCase(), providerPaymentId: payment.providerPaymentId, released }, { status: 409 });
    }

    const { error: markError } = await admin.rpc("mark_flow_qr_payment_submitted", {
      p_operation_id: current.id,
      p_user_id: user.id,
      p_actor_id: user.id,
      p_provider_payment_id: payment.providerPaymentId,
      p_provider_status: payment.status,
    });
    if (markError) throw new Error(markError.message);

    if (payment.status === "CONFIRMED") {
      const { data: confirmed, error: confirmError } = await admin.rpc("confirm_flow_qr_payment", {
        p_operation_id: current.id,
        p_user_id: user.id,
        p_actor_id: user.id,
        p_provider_payment_id: payment.providerPaymentId,
        p_custody_reference: `sandbox:${payment.providerPaymentId}`,
      });
      if (confirmError) throw new Error(confirmError.message);
      return NextResponse.json({ operationId: current.id, status: "payment_confirmed", providerPaymentId: payment.providerPaymentId, confirmed });
    }

    return NextResponse.json({ operationId: current.id, status: "payment_pending", providerPaymentId: payment.providerPaymentId, providerStatus: payment.status }, { status: 202 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo ejecutar el pago QR." }, { status });
  }
}
