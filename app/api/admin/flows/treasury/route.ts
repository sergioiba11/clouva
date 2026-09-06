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

function maskReference(value: string | null | undefined) {
  return value ? `••••${value.slice(-6)}` : null;
}

function numberFromMetadata(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = Number((metadata as Record<string, unknown>)[key]);
  return Number.isFinite(value) ? value : null;
}

function stringFromMetadata(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireAdmin(request);
    const [snapshotResult, reconciliationResult, operationsResult, accountsResult, fundingResult, allocationsResult] = await Promise.all([
      admin.rpc("flow_treasury_snapshot"),
      admin.rpc("flow_reconciliation_report"),
      admin
        .from("flow_purchase_operations")
        .select("id,buyer_user_id,buyer_player_id,recipient_user_id,recipient_player_id,provider,provider_payment_id,provider_reference,payment_method,quantity,unit_usd,amount,required_backing_usd,backing_amount,processing_fee_amount,processing_fee_policy,currency,status,backing_status,operation_type,target_asset_id,fx_rate_original_per_usd,fx_pair,fx_source,fx_quoted_at,provider_fee,net_amount,confirmed_at,issued_at,refund_status,created_at,metadata")
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("flow_reserve_accounts")
        .select("id,name,provider,account_type,currency,account_reference,status,is_active,flow_account_role,authorized_for_flow,authorized_at,authorized_by,authorized_for_collection,collection_authorized_at,collection_authorized_by,metadata,created_at,updated_at")
        .order("created_at", { ascending: true }),
      admin
        .from("flow_funding_ledger")
        .select("id,operation_id,entry_type,provider,payment_method,amount,currency,status,external_payment_id,provider_fee,net_amount,idempotency_key,occurred_at,reverses_entry_id,reserve_account_id,custody_status,custody_reference,custody_confirmed_at,reference_usd_amount,custody_stage,metadata")
        .order("occurred_at", { ascending: false }),
      admin
        .from("flow_backing_allocations")
        .select("id,flow_asset_id,reserve_account_id,funding_entry_id,reference_usd_value,status,allocated_at,released_at")
        .order("allocated_at", { ascending: false }),
    ]);
    for (const result of [snapshotResult, reconciliationResult, operationsResult, accountsResult, fundingResult, allocationsResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const operations = operationsResult.data ?? [];
    const fundingRows = fundingResult.data ?? [];
    const allocations = allocationsResult.data ?? [];
    const rawAccounts = accountsResult.data ?? [];
    const operationIds = operations.map((row) => row.id);
    const playerIds = [...new Set(operations.flatMap((row) => [row.buyer_player_id, row.recipient_player_id].filter(Boolean) as string[]))];

    const [playersResult, documentsResult, walletLedgerResult] = await Promise.all([
      playerIds.length
        ? admin.from("players").select("id,display_name,slug").in("id", playerIds)
        : Promise.resolve({ data: [], error: null }),
      operationIds.length
        ? admin.from("flow_payment_documents").select("id,operation_id,kind,provider,document_type,status,document_number,external_document_id,issued_at,created_at").in("operation_id", operationIds)
        : Promise.resolve({ data: [], error: null }),
      operationIds.length
        ? admin.from("flows_wallet_ledger").select("id,user_id,transaction_type,amount,balance_after,source,reference_id,created_at").in("reference_id", operationIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const result of [playersResult, documentsResult, walletLedgerResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const players = new Map((playersResult.data ?? []).map((row) => [row.id, row]));
    const group = <T extends { operation_id: string | null }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const row of rows) {
        if (!row.operation_id) continue;
        const list = map.get(row.operation_id) ?? [];
        list.push(row);
        map.set(row.operation_id, list);
      }
      return map;
    };
    const funding = group(fundingRows as Array<{ operation_id: string | null } & Record<string, unknown>>);
    const documents = group((documentsResult.data ?? []) as Array<{ operation_id: string | null } & Record<string, unknown>>);
    const walletLedger = new Map<string, Array<Record<string, unknown>>>();
    for (const row of walletLedgerResult.data ?? []) {
      if (!row.reference_id) continue;
      const list = walletLedger.get(row.reference_id) ?? [];
      list.push(row);
      walletLedger.set(row.reference_id, list);
    }

    const normalizedAccounts = rawAccounts.map((account) => {
      const rows = fundingRows.filter((row) => row.reserve_account_id === account.id);
      const activeAllocations = allocations.filter((row) => row.reserve_account_id === account.id && row.status === "active");
      const isReserve = account.flow_account_role === "reserve";
      const creditsUsd = isReserve
        ? rows
            .filter((row) => row.entry_type === "reserve_deposit" && row.status === "confirmed" && row.custody_status === "confirmed" && ["reserve_confirmed", "allocated"].includes(row.custody_stage))
            .reduce((sum, row) => sum + Number(row.reference_usd_amount ?? 0), 0)
        : 0;
      const debitsUsd = isReserve
        ? rows
            .filter((row) => row.status === "confirmed" && ["refund", "reversal", "reserve_release"].includes(row.entry_type) && ["confirmed", "released", "reversed"].includes(row.custody_status))
            .reduce((sum, row) => sum + Number(row.reference_usd_amount ?? 0), 0)
        : 0;
      const allocatedUsd = isReserve ? activeAllocations.reduce((sum, row) => sum + Number(row.reference_usd_value ?? 0), 0) : 0;
      return {
        ...account,
        account_reference: maskReference(account.account_reference),
        reserveUsd: creditsUsd - debitsUsd,
        allocatedUsd,
        freeUsd: creditsUsd - debitsUsd - allocatedUsd,
        activeAllocations: isReserve ? activeAllocations.length : 0,
        lastMovementAt: rows[0]?.occurred_at ?? null,
      };
    });
    const reserveAccounts = normalizedAccounts.filter((account) => account.flow_account_role === "reserve");
    const collectionRails = normalizedAccounts.filter((account) => account.flow_account_role === "collection_rail");

    let mercadoPago: Record<string, unknown> = {
      enabled: isBillingEnabled(),
      connected: false,
      environment: null,
      configuredCollectorId: null,
      reportedCollectorId: null,
      matchesConfiguredCollector: null,
      collectionAuthorized: false,
      collectionRailAccountId: null,
      nickname: null,
      countryId: null,
      siteStatus: null,
    };
    if (isBillingEnabled()) {
      try {
        const config = getMercadoPagoConfig();
        const merchant = await new MercadoPagoProvider(config).getCurrentUser();
        const reportedCollectorId = text(merchant.id);
        const matchingRail = rawAccounts.find((account) =>
          account.provider === "mercadopago"
          && account.currency === "ARS"
          && account.account_reference === config.userId
          && account.flow_account_role === "collection_rail"
          && account.authorized_for_collection
          && account.is_active
          && account.status === "active",
        );
        mercadoPago = {
          enabled: true,
          connected: Boolean(reportedCollectorId),
          environment: config.environment,
          configuredCollectorId: maskReference(config.userId),
          reportedCollectorId: maskReference(reportedCollectorId),
          matchesConfiguredCollector: reportedCollectorId === config.userId,
          collectionAuthorized: Boolean(matchingRail),
          collectionRailAccountId: matchingRail?.id ?? null,
          nickname: text(merchant.nickname),
          countryId: text(merchant.country_id),
          siteStatus: text(merchant.site_status),
        };
      } catch (merchantError) {
        mercadoPago = { ...mercadoPago, lookupError: merchantError instanceof Error ? merchantError.message : "No se pudo verificar la cuenta de cobro." };
      }
    }

    const fundsToMove = operations
      .filter((operation) => operation.provider === "mercadopago" && operation.status === "confirmed" && operation.backing_status !== "verified" && operation.backing_status !== "reversed")
      .map((operation) => {
        const rows = funding.get(operation.id) ?? [];
        const reserveDepositsUsd = rows
          .filter((row) => row.entry_type === "reserve_deposit" && row.status === "confirmed" && row.custody_status === "confirmed")
          .reduce((sum, row) => sum + Number(row.reference_usd_amount ?? 0), 0);
        let processorNetReferenceUsd = numberFromMetadata(operation.metadata, "processorNetReferenceUsd");
        if (processorNetReferenceUsd == null && operation.net_amount != null) {
          if (operation.currency === "USD") processorNetReferenceUsd = Number(operation.net_amount);
          else if (Number(operation.fx_rate_original_per_usd) > 0) processorNetReferenceUsd = Number(operation.net_amount) / Number(operation.fx_rate_original_per_usd);
        }
        const requiredBackingUsd = Number(operation.required_backing_usd ?? 0);
        const requiredTransferUsd = processorNetReferenceUsd == null ? requiredBackingUsd : Math.min(requiredBackingUsd, Math.max(processorNetReferenceUsd, 0));
        const remainingTransferUsd = Math.max(requiredTransferUsd - reserveDepositsUsd, 0);
        const fundingStage = rows.find((row) => row.entry_type === "funding")?.custody_stage;
        return {
          operationId: operation.id,
          quantity: Number(operation.quantity),
          currency: operation.currency,
          grossAmount: Number(operation.amount),
          providerFee: Number(operation.provider_fee ?? 0),
          netAmount: Number(operation.net_amount ?? 0),
          requiredBackingUsd,
          processorNetReferenceUsd,
          reserveDepositsUsd,
          requiredTransferUsd,
          remainingTransferUsd,
          paymentStage: stringFromMetadata(operation.metadata, "paymentStage") ?? (typeof fundingStage === "string" ? fundingStage : "received_by_processor"),
          confirmedAt: operation.confirmed_at,
          recipientPlayer: operation.recipient_player_id ? players.get(operation.recipient_player_id) ?? null : null,
        };
      });

    return NextResponse.json({
      snapshot: snapshotResult.data,
      reconciliation: reconciliationResult.data ?? [],
      mercadoPago,
      collectionRails,
      reserveAccounts,
      fundsToMove,
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
