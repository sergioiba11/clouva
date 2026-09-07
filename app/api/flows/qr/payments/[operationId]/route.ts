import { NextRequest, NextResponse } from "next/server";
import { formatFlowUnits } from "@/core/flows/money/units";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ operationId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { operationId } = await params;
    if (!UUID_RE.test(operationId)) return NextResponse.json({ error: "Operación QR inválida." }, { status: 400 });

    const admin = createAdminSupabase();
    const { data: operation, error } = await admin
      .from("flow_qr_payment_operations")
      .select("id,status,capability,provider,administrator,merchant_name,merchant_id,merchant_city,merchant_amount,merchant_currency,qr_type,qr_transaction_id,provider_order_id,dynamic_qr,amount_editable,fx_pair,fx_rate,fx_source,fx_quoted_at,quote_expires_at,reference_usd,flow_units,provider_fee_units,clouva_fee_units,total_flow_units,rail_provider,rail_method,provider_payment_id,provider_status,sandbox,last_error_code,last_safe_message,submitted_at,confirmed_at,failed_at,expired_at,reversed_at,created_at,updated_at")
      .eq("id", operationId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!operation) return NextResponse.json({ error: "Operación QR inexistente." }, { status: 404 });

    const { data: items, error: itemsError } = await admin
      .from("flow_qr_payment_items")
      .select("held_units,status,reference_usd_value,flow_asset_id")
      .eq("operation_id", operation.id)
      .order("created_at", { ascending: true });
    if (itemsError) throw new Error(itemsError.message);

    return NextResponse.json({
      operation: {
        ...operation,
        flowAmount: operation.flow_units ? formatFlowUnits(String(operation.flow_units)) : null,
        totalFlow: operation.total_flow_units ? formatFlowUnits(String(operation.total_flow_units)) : null,
        items: (items ?? []).map((item) => ({
          flowAssetId: item.flow_asset_id,
          heldUnits: String(item.held_units),
          flowAmount: formatFlowUnits(String(item.held_units)),
          referenceUsd: String(item.reference_usd_value),
          status: item.status,
        })),
      },
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo recuperar el pago QR." }, { status });
  }
}
