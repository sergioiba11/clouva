import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function statusForError(message: string) {
  if (/id de transferencia ya pertenece|idempot/i.test(message)) return 409;
  if (/saldo|cantidad|qr|publicaci|variante|cotizaci|spot|beneficiario|stock|flow/i.test(message)) return 400;
  return 500;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const operationId = request.nextUrl.searchParams.get("operationId")?.trim() || "";
    if (!UUID_RE.test(operationId)) {
      return NextResponse.json({ error: "operationId inválido." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { data, error } = await admin
      .from("flow_transfer_operations")
      .select("id,status,subject_type,quantity,spot_id,order_id,payment_id,result,created_at,completed_at")
      .eq("id", operationId)
      .eq("sender_user_id", user.id)
      .eq("subject_type", "COMMERCE_QR")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "Operación no encontrada." }, { status: 404 });

    return NextResponse.json({ sale: data.result ?? null, operation: data });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo recuperar la compra FLOW." }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const operationId = request.headers.get("idempotency-key")?.trim() || "";
    if (!UUID_RE.test(operationId)) {
      return NextResponse.json({ error: "La compra necesita un idempotency-key UUID válido." }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      publicToken?: string;
      listingId?: string;
      variantId?: string | null;
      quantity?: number;
      fxRateId?: string;
      customerName?: string | null;
      customerEmail?: string | null;
    };

    const publicToken = body.publicToken?.trim() || "";
    const listingId = body.listingId?.trim() || "";
    const variantId = body.variantId?.trim() || null;
    const fxRateId = body.fxRateId?.trim() || "";
    const quantity = Math.floor(Number(body.quantity));

    if (!publicToken || !UUID_RE.test(listingId) || (variantId && !UUID_RE.test(variantId)) || !UUID_RE.test(fxRateId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      return NextResponse.json({ error: "La compra FLOW tiene datos inválidos." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { data, error } = await admin.rpc("complete_commerce_flow_qr_sale", {
      p_sender_user_id: user.id,
      p_public_token: publicToken,
      p_listing_id: listingId,
      p_variant_id: variantId,
      p_purchase_quantity: quantity,
      p_fx_rate_id: fxRateId,
      p_transfer_id: operationId,
      p_actor_id: user.id,
      p_customer_name: body.customerName?.trim() || null,
      p_customer_email: body.customerEmail?.trim().toLowerCase() || null,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: statusForError(error.message) });
    }

    const duplicate = Boolean((data as { duplicate?: boolean } | null)?.duplicate);
    return NextResponse.json({ sale: data }, { status: duplicate ? 200 : 201 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo completar la compra con FLOW." }, { status });
  }
}
