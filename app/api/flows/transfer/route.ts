import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanToken(value: unknown) {
  if (typeof value !== "string") return "";
  const token = value.trim();
  return token.length >= 32 && token.length <= 160 && /^[A-Za-z0-9_-]+$/.test(token) ? token : "";
}

function cleanQuantity(value: unknown) {
  const quantity = Number(value);
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 50 ? quantity : null;
}

function statusForMessage(message: string) {
  if (/Saldo de Flows insuficiente|No hay suficientes FLOWS/i.test(message)) return 409;
  if (/reconciliad|respalda|reserva|custodia|otra operación/i.test(message)) return 409;
  if (/QR.*activo|QR.*Player|no corresponde/i.test(message)) return 404;
  if (/otro Player|vos mismo|cantidad|incompleta|inválida/i.test(message)) return 400;
  return 500;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const operationId = request.nextUrl.searchParams.get("operationId")?.trim() || "";
    if (!UUID_RE.test(operationId)) {
      return NextResponse.json({ error: "Falta un id de operación FLOW válido." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("flow_transfer_operations")
      .select("id,status,quantity,recipient_user_id,qr_registry_id,spot_id,order_id,payment_id,result,created_at,completed_at")
      .eq("id", operationId)
      .eq("sender_user_id", user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "La operación FLOW todavía no fue registrada." }, { status: 404 });

    return NextResponse.json({ operation: data, transfer: data.result ?? null });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo recuperar la operación FLOW." },
      { status },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = await request.json().catch(() => ({}));
    const publicToken = cleanToken(body?.publicToken);
    const quantity = cleanQuantity(body?.quantity);
    const transferId = request.headers.get("idempotency-key")?.trim() || "";

    if (!publicToken) return NextResponse.json({ error: "QR CLOUVA inválido." }, { status: 400 });
    if (!quantity) return NextResponse.json({ error: "La cantidad debe estar entre 1 y 50 FLOW." }, { status: 400 });
    if (!UUID_RE.test(transferId)) {
      return NextResponse.json({ error: "Falta una clave de idempotencia válida para el pago." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { data, error } = await admin.rpc("execute_flow_qr_transfer", {
      p_sender_user_id: user.id,
      p_public_token: publicToken,
      p_quantity: quantity,
      p_transfer_id: transferId,
      p_actor_id: user.id,
    });
    if (error) {
      const message = error.message || "No se pudo completar el pago en FLOW.";
      return NextResponse.json({ error: message, operationId: transferId }, { status: statusForMessage(message) });
    }

    return NextResponse.json({ operationId: transferId, operation: data, transfer: data });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo completar el pago en FLOW." },
      { status },
    );
  }
}
