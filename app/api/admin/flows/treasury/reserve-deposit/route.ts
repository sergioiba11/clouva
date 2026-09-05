import { NextRequest, NextResponse } from "next/server";
import { getFlowCheckoutQuote } from "@/lib/server/flow-pricing";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(request: NextRequest) {
  const { user } = await requireUser(request);
  const admin = createAdminSupabase();
  const { data: profile, error } = await admin.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (profile?.role !== "admin") {
    const forbidden = new Error("No autorizado.");
    (forbidden as Error & { status?: number }).status = 403;
    throw forbidden;
  }
  return { adminUser: user, admin };
}

export async function POST(request: NextRequest) {
  try {
    const { adminUser, admin } = await requireAdmin(request);
    const body = (await request.json().catch(() => ({}))) as {
      operationId?: unknown;
      reserveAccountId?: unknown;
      amount?: unknown;
      currency?: unknown;
      custodyReference?: unknown;
      occurredAt?: unknown;
      idempotencyKey?: unknown;
    };

    const operationId = typeof body.operationId === "string" ? body.operationId.trim() : "";
    const reserveAccountId = typeof body.reserveAccountId === "string" ? body.reserveAccountId.trim() : "";
    const amount = Number(body.amount);
    const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "";
    const custodyReference = typeof body.custodyReference === "string" ? body.custodyReference.trim().slice(0, 160) : "";
    const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim().slice(0, 160) : "";
    const occurredAtRaw = typeof body.occurredAt === "string" ? body.occurredAt.trim() : "";
    const occurredAt = occurredAtRaw && !Number.isNaN(Date.parse(occurredAtRaw)) ? new Date(occurredAtRaw).toISOString() : new Date().toISOString();

    if (!operationId || !reserveAccountId || !Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency) || !idempotencyKey) {
      return NextResponse.json({ error: "Faltan operación, cuenta, importe, moneda o clave de depósito." }, { status: 400 });
    }

    const [{ data: account, error: accountError }, { data: operation, error: operationError }] = await Promise.all([
      admin.from("flow_reserve_accounts").select("id,name,provider,currency,status,is_active").eq("id", reserveAccountId).maybeSingle(),
      admin.from("flow_purchase_operations").select("id,status,backing_status,recipient_user_id").eq("id", operationId).maybeSingle(),
    ]);
    if (accountError) throw new Error(accountError.message);
    if (operationError) throw new Error(operationError.message);
    if (!account || !account.is_active || account.status !== "active") return NextResponse.json({ error: "Cuenta de reserva inválida." }, { status: 422 });
    if (!operation || operation.status !== "confirmed") return NextResponse.json({ error: "La operación no está confirmada para recibir respaldo." }, { status: 422 });
    if (account.currency.toUpperCase() !== currency) return NextResponse.json({ error: `La cuenta de reserva recibe ${account.currency}.` }, { status: 422 });

    let referenceUsdAmount: number;
    if (currency === "USD") {
      referenceUsdAmount = amount;
    } else {
      const quote = await getFlowCheckoutQuote();
      if (quote.checkoutCurrency.toUpperCase() !== currency || !Number.isFinite(quote.fxRateOriginalPerUsd) || quote.fxRateOriginalPerUsd <= 0) {
        return NextResponse.json({ error: `No hay cotización canónica disponible para ${currency}.` }, { status: 422 });
      }
      referenceUsdAmount = amount / quote.fxRateOriginalPerUsd;
    }

    if (!Number.isFinite(referenceUsdAmount) || referenceUsdAmount <= 0) {
      return NextResponse.json({ error: "El equivalente USD del depósito es inválido." }, { status: 422 });
    }

    const { data, error } = await admin.rpc("confirm_flow_reserve_deposit", {
      p_operation_id: operationId,
      p_reserve_account_id: reserveAccountId,
      p_amount: amount,
      p_currency: currency,
      p_reference_usd_amount: referenceUsdAmount,
      p_custody_reference: custodyReference || null,
      p_occurred_at: occurredAt,
      p_idempotency_key: idempotencyKey,
      p_confirmed_by: adminUser.id,
      p_metadata: {
        quoteSource: currency === "USD" ? "identity" : "clouva_canonical_fx",
        referenceUsdAmount,
      },
    });
    if (error) throw new Error(error.message);

    return NextResponse.json(data, { headers: { "cache-control": "private, no-store, max-age=0" } });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo confirmar el depósito de respaldo." }, { status });
  }
}
