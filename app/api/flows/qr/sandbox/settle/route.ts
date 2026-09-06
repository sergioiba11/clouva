import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { universalQrSandboxEnabled } from "@/core/flows/qr/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    if (!universalQrSandboxEnabled()) return NextResponse.json({ error: "Sandbox Universal QR deshabilitado." }, { status: 404 });
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { operationId?: unknown; outcome?: unknown };
    const operationId = typeof body.operationId === "string" ? body.operationId.trim() : "";
    const outcome = typeof body.outcome === "string" ? body.outcome.trim().toLowerCase() : "";
    if (!UUID_RE.test(operationId) || !["confirmed", "failed"].includes(outcome)) {
      return NextResponse.json({ error: "Settlement sandbox inválido." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { data: operation, error } = await admin
      .from("flow_qr_payment_operations")
      .select("id,user_id,status,provider,provider_payment_id,sandbox")
      .eq("id", operationId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!operation || !operation.sandbox || operation.provider !== "sandbox") return NextResponse.json({ error: "Operación sandbox inexistente." }, { status: 404 });
    if (!["payment_pending", "payment_submitted", "flow_held"].includes(operation.status)) {
      return NextResponse.json({ operationId, status: operation.status, recovered: true });
    }

    const providerPaymentId = operation.provider_payment_id || `sbx_manual_${operation.id}`;
    const eventId = `sandbox:${operation.id}:${outcome}`;
    const payload = { operationId: operation.id, providerPaymentId, outcome };
    const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const { error: eventError } = await admin.from("flow_qr_payment_events").insert({
      operation_id: operation.id,
      provider: "sandbox",
      provider_event_id: eventId,
      provider_payment_id: providerPaymentId,
      event_status: outcome.toUpperCase(),
      payload_hash: payloadHash,
      signature_valid: true,
      payload,
      processed_at: new Date().toISOString(),
    });
    if (eventError && eventError.code !== "23505") throw new Error(eventError.message);

    if (outcome === "confirmed") {
      const { data: confirmed, error: confirmError } = await admin.rpc("confirm_flow_qr_payment", {
        p_operation_id: operation.id,
        p_user_id: user.id,
        p_actor_id: user.id,
        p_provider_payment_id: providerPaymentId,
        p_custody_reference: `sandbox:${providerPaymentId}`,
      });
      if (confirmError) throw new Error(confirmError.message);
      return NextResponse.json({ operationId: operation.id, status: "payment_confirmed", confirmed });
    }

    const { data: released, error: releaseError } = await admin.rpc("release_flow_qr_payment", {
      p_operation_id: operation.id,
      p_user_id: user.id,
      p_actor_id: user.id,
      p_final_status: "failed",
      p_error_code: "sandbox_rejected",
      p_safe_message: "El sandbox rechazó el pago. Los FLOW fueron liberados.",
    });
    if (releaseError) throw new Error(releaseError.message);
    return NextResponse.json({ operationId: operation.id, status: "failed", released });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cerrar el pago sandbox." }, { status });
  }
}
