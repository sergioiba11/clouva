import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoProvider } from "@/core/billing/providers/mercadopago/client";
import { getMercadoPagoConfig, isBillingEnabled } from "@/core/billing/providers/mercadopago/config";
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
  return { admin };
}

function text(value: unknown) {
  return value == null ? null : String(value);
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireAdmin(request);
    const [{ data: snapshot, error: snapshotError }, { data: reconciliation, error: reconciliationError }, operationsResult] = await Promise.all([
      admin.rpc("flow_treasury_snapshot"),
      admin.rpc("flow_reconciliation_report"),
      admin
        .from("flow_purchase_operations")
        .select("id,buyer_user_id,buyer_player_id,recipient_user_id,recipient_player_id,provider,provider_payment_id,provider_reference,payment_method,quantity,unit_usd,amount,currency,status,backing_status,operation_type,target_asset_id,fx_rate_original_per_usd,fx_pair,fx_source,fx_quoted_at,provider_fee,net_amount,confirmed_at,issued_at,refund_status,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    if (snapshotError) throw new Error(snapshotError.message);
    if (reconciliationError) throw new Error(reconciliationError.message);
    if (operationsResult.error) throw new Error(operationsResult.error.message);

    const operations = operationsResult.data ?? [];
    const operationIds = operations.map((row) => row.id);
    const playerIds = [...new Set(operations.flatMap((row) => [row.buyer_player_id, row.recipient_player_id].filter(Boolean) as string[]))];

    const [playersResult, fundingResult, documentsResult, walletLedgerResult] = await Promise.all([
      playerIds.length
        ? admin.from("players").select("id,display_name,slug").in("id", playerIds)
        : Promise.resolve({ data: [], error: null }),
      operationIds.length
        ? admin
            .from("flow_funding_ledger")
            .select("id,operation_id,entry_type,provider,payment_method,amount,currency,status,external_payment_id,provider_fee,net_amount,idempotency_key,occurred_at,reverses_entry_id")
            .in("operation_id", operationIds)
            .order("occurred_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      operationIds.length
        ? admin
            .from("flow_payment_documents")
            .select("id,operation_id,kind,provider,document_type,status,document_number,external_document_id,issued_at,created_at")
            .in("operation_id", operationIds)
        : Promise.resolve({ data: [], error: null }),
      operationIds.length
        ? admin
            .from("flows_wallet_ledger")
            .select("id,user_id,transaction_type,amount,balance_after,source,reference_id,created_at")
            .in("reference_id", operationIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [playersResult, fundingResult, documentsResult, walletLedgerResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const players = new Map((playersResult.data ?? []).map((row) => [row.id, row]));
    const group = <T extends { operation_id: string }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const row of rows) {
        const list = map.get(row.operation_id) ?? [];
        list.push(row);
        map.set(row.operation_id, list);
      }
      return map;
    };
    const funding = group((fundingResult.data ?? []) as Array<{ operation_id: string } & Record<string, unknown>>);
    const documents = group((documentsResult.data ?? []) as Array<{ operation_id: string } & Record<string, unknown>>);
    const walletLedger = new Map<string, Array<Record<string, unknown>>>();
    for (const row of walletLedgerResult.data ?? []) {
      if (!row.reference_id) continue;
      const list = walletLedger.get(row.reference_id) ?? [];
      list.push(row);
      walletLedger.set(row.reference_id, list);
    }

    let mercadoPago: Record<string, unknown> = {
      enabled: isBillingEnabled(),
      connected: false,
      environment: null,
      configuredCollectorId: null,
      reportedCollectorId: null,
      matchesConfiguredCollector: null,
      nickname: null,
      countryId: null,
      siteStatus: null,
      accountBalance: null,
      accountBalanceAvailable: false,
    };
    if (isBillingEnabled()) {
      try {
        const config = getMercadoPagoConfig();
        const merchant = await new MercadoPagoProvider(config).getCurrentUser();
        const reportedCollectorId = text(merchant.id);
        mercadoPago = {
          enabled: true,
          connected: Boolean(reportedCollectorId),
          environment: config.environment,
          configuredCollectorId: config.userId,
          reportedCollectorId,
          matchesConfiguredCollector: reportedCollectorId === config.userId,
          nickname: text(merchant.nickname),
          countryId: text(merchant.country_id),
          siteStatus: text(merchant.site_status),
          accountBalance: null,
          accountBalanceAvailable: false,
        };
      } catch (merchantError) {
        mercadoPago = {
          ...mercadoPago,
          lookupError: merchantError instanceof Error ? merchantError.message : "No se pudo verificar la cuenta receptora.",
        };
      }
    }

    return NextResponse.json({
      snapshot,
      reconciliation: reconciliation ?? [],
      mercadoPago,
      operations: operations.map((operation) => ({
        ...operation,
        buyerPlayer: operation.buyer_player_id ? players.get(operation.buyer_player_id) ?? null : null,
        recipientPlayer: operation.recipient_player_id ? players.get(operation.recipient_player_id) ?? null : null,
        funding: funding.get(operation.id) ?? [],
        documents: documents.get(operation.id) ?? [],
        walletLedger: walletLedger.get(operation.id) ?? [],
      })),
    }, { headers: { "cache-control": "private, no-store, max-age=0" } });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cargar Tesorería FLOW." }, { status });
  }
}
