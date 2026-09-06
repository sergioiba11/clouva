import { NextRequest, NextResponse } from "next/server";
import { getFlowCheckoutQuote, roundMoney } from "@/lib/server/flow-pricing";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FundingRow = {
  id: string;
  operation_id: string | null;
  entry_type: string;
  provider: string | null;
  payment_method: string | null;
  amount: number;
  currency: string;
  status: string;
  external_payment_id: string | null;
  provider_fee: number | null;
  net_amount: number | null;
  occurred_at: string;
  reserve_account_id: string | null;
  custody_status: string;
  custody_reference: string | null;
  custody_confirmed_at: string | null;
  reference_usd_amount: number | null;
};

type PaymentDocumentRow = {
  id: string;
  operation_id: string;
  kind: string;
  provider: string | null;
  document_type: string | null;
  status: string;
  document_number: string | null;
  external_document_id: string | null;
  issued_at: string | null;
  created_at: string;
};

type AssetMovementRow = {
  id: string;
  flow_asset_id: string;
  action: string;
  from_player_id: string | null;
  to_player_id: string | null;
  operation_id: string | null;
  created_at: string;
};

type BackingAllocationRow = {
  id: string;
  flow_asset_id: string;
  reserve_account_id: string;
  funding_entry_id: string | null;
  reference_usd_value: number;
  status: string;
  allocated_at: string;
  released_at: string | null;
};

const operationSelect = "id,buyer_player_id,recipient_player_id,provider,provider_payment_id,provider_reference,payment_method,quantity,unit_usd,amount,required_backing_usd,backing_amount,processing_fee_amount,processing_fee_policy,currency,status,backing_status,confirmed_at,issued_at,created_at,fx_rate_original_per_usd,fx_pair,fx_source,fx_quoted_at,provider_fee,net_amount,refund_status,operation_type,target_asset_id";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();

    const [assetsResult, pricingResult, recentResult] = await Promise.all([
      admin
        .from("flow_assets")
        .select("id,flow_number,status,issued_at,activated_at,backed_at,owner_player_id,original_buyer_player_id,operation_id,backing_operation_id")
        .eq("owner_user_id", user.id)
        .order("flow_number", { ascending: true }),
      admin
        .from("flow_issuance_settings")
        .select("flow_usd_value,processing_fee_policy,processing_fee_bps,processing_fee_fixed_usd")
        .eq("id", "canonical")
        .single(),
      admin
        .from("flow_purchase_operations")
        .select(operationSelect)
        .or(`buyer_user_id.eq.${user.id},recipient_user_id.eq.${user.id}`)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    if (assetsResult.error) throw new Error(assetsResult.error.message);
    if (pricingResult.error) throw new Error(pricingResult.error.message);
    if (recentResult.error) throw new Error(recentResult.error.message);

    const assets = assetsResult.data ?? [];
    const recentOperations = recentResult.data ?? [];
    const operationIds = [...new Set([
      ...assets.flatMap((row) => [row.operation_id, row.backing_operation_id].filter(Boolean) as string[]),
      ...recentOperations.map((row) => row.id),
    ])];
    const assetIds = assets.map((row) => row.id);
    const playerIds = [...new Set([
      ...assets.flatMap((row) => [row.owner_player_id, row.original_buyer_player_id].filter(Boolean) as string[]),
      ...recentOperations.flatMap((row) => [row.buyer_player_id, row.recipient_player_id].filter(Boolean) as string[]),
    ])];

    const [operationsResult, playersResult, fundingResult, documentsResult, movementsResult, allocationsResult] = await Promise.all([
      operationIds.length
        ? admin.from("flow_purchase_operations").select(operationSelect).in("id", operationIds)
        : Promise.resolve({ data: [], error: null }),
      playerIds.length
        ? admin.from("players").select("id,display_name,slug").in("id", playerIds)
        : Promise.resolve({ data: [], error: null }),
      operationIds.length
        ? admin
            .from("flow_funding_ledger")
            .select("id,operation_id,entry_type,provider,payment_method,amount,currency,status,external_payment_id,provider_fee,net_amount,occurred_at,reserve_account_id,custody_status,custody_reference,custody_confirmed_at,reference_usd_amount")
            .in("operation_id", operationIds)
            .order("occurred_at", { ascending: true })
        : Promise.resolve({ data: [] as FundingRow[], error: null }),
      operationIds.length
        ? admin
            .from("flow_payment_documents")
            .select("id,operation_id,kind,provider,document_type,status,document_number,external_document_id,issued_at,created_at")
            .in("operation_id", operationIds)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as PaymentDocumentRow[], error: null }),
      assetIds.length
        ? admin
            .from("flow_asset_movements")
            .select("id,flow_asset_id,action,from_player_id,to_player_id,operation_id,created_at")
            .in("flow_asset_id", assetIds)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as AssetMovementRow[], error: null }),
      assetIds.length
        ? admin
            .from("flow_backing_allocations")
            .select("id,flow_asset_id,reserve_account_id,funding_entry_id,reference_usd_value,status,allocated_at,released_at")
            .in("flow_asset_id", assetIds)
            .order("allocated_at", { ascending: false })
        : Promise.resolve({ data: [] as BackingAllocationRow[], error: null }),
    ]);
    for (const result of [operationsResult, playersResult, fundingResult, documentsResult, movementsResult, allocationsResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const reserveAccountIds = [...new Set(((allocationsResult.data ?? []) as BackingAllocationRow[]).map((row) => row.reserve_account_id))];
    const reserveAccountsResult = reserveAccountIds.length
      ? await admin
          .from("flow_reserve_accounts")
          .select("id,name,provider,account_type,currency,status,is_active,authorized_for_flow")
          .in("id", reserveAccountIds)
      : { data: [], error: null };
    if (reserveAccountsResult.error) throw new Error(reserveAccountsResult.error.message);

    const operations = new Map((operationsResult.data ?? []).map((row) => [row.id, row]));
    const players = new Map((playersResult.data ?? []).map((row) => [row.id, row]));
    const reserveAccounts = new Map((reserveAccountsResult.data ?? []).map((row) => [row.id, row]));
    const fundingByOperation = new Map<string, FundingRow[]>();
    for (const row of (fundingResult.data ?? []) as FundingRow[]) {
      if (!row.operation_id) continue;
      const rows = fundingByOperation.get(row.operation_id) ?? [];
      rows.push(row);
      fundingByOperation.set(row.operation_id, rows);
    }
    const documentsByOperation = new Map<string, PaymentDocumentRow[]>();
    for (const row of (documentsResult.data ?? []) as PaymentDocumentRow[]) {
      const rows = documentsByOperation.get(row.operation_id) ?? [];
      rows.push(row);
      documentsByOperation.set(row.operation_id, rows);
    }
    const movementsByAsset = new Map<string, AssetMovementRow[]>();
    for (const row of (movementsResult.data ?? []) as AssetMovementRow[]) {
      const rows = movementsByAsset.get(row.flow_asset_id) ?? [];
      rows.push(row);
      movementsByAsset.set(row.flow_asset_id, rows);
    }
    const allocationByAsset = new Map<string, BackingAllocationRow>();
    for (const row of (allocationsResult.data ?? []) as BackingAllocationRow[]) {
      if (allocationByAsset.has(row.flow_asset_id)) continue;
      allocationByAsset.set(row.flow_asset_id, row);
    }

    const withFinancialDetails = (operationId: string | null | undefined) => {
      if (!operationId) return null;
      const operation = operations.get(operationId);
      if (!operation) return null;
      return {
        ...operation,
        buyerPlayer: operation.buyer_player_id ? players.get(operation.buyer_player_id) ?? null : null,
        recipientPlayer: operation.recipient_player_id ? players.get(operation.recipient_player_id) ?? null : null,
        funding: fundingByOperation.get(operation.id) ?? [],
        documents: documentsByOperation.get(operation.id) ?? [],
      };
    };

    const flowUsdValue = Number(pricingResult.data.flow_usd_value);
    const processingFeePolicy = String(pricingResult.data.processing_fee_policy || "clouva_absorbs");
    const processingFeeBps = Number(pricingResult.data.processing_fee_bps || 0);
    const processingFeeFixedUsd = Number(pricingResult.data.processing_fee_fixed_usd || 0);
    let checkoutPricing: Record<string, unknown> = {
      flowUsdValue,
      referenceCurrency: "USD",
      checkoutCurrency: null,
      fxRate: null,
      fxPair: null,
      fxSource: null,
      fxQuotedAt: null,
      checkoutUnitAmount: null,
      processingFeePolicy,
      processingFeeBps,
      processingFeeFixedUsd,
    };
    try {
      const quote = await getFlowCheckoutQuote();
      checkoutPricing = {
        flowUsdValue,
        referenceCurrency: "USD",
        checkoutCurrency: quote.checkoutCurrency,
        fxRate: quote.fxRateOriginalPerUsd,
        fxPair: quote.fxPair,
        fxSource: quote.fxSource,
        fxQuotedAt: quote.fxQuotedAt,
        quoteSourceDate: quote.sourceDate,
        checkoutUnitAmount: roundMoney(flowUsdValue * quote.fxRateOriginalPerUsd),
        processingFeePolicy,
        processingFeeBps,
        processingFeeFixedUsd,
      };
    } catch (quoteError) {
      console.error("flow_checkout_quote_unavailable", { message: quoteError instanceof Error ? quoteError.message : "unknown" });
    }

    return NextResponse.json({
      pricing: checkoutPricing,
      recentOperations: recentOperations.map((row) => withFinancialDetails(row.id)).filter(Boolean),
      assets: assets.map((asset) => {
        const originOperation = withFinancialDetails(asset.operation_id);
        const backingOperation = withFinancialDetails(asset.backing_operation_id);
        const allocation = allocationByAsset.get(asset.id) ?? null;
        const reserveAccount = allocation ? reserveAccounts.get(allocation.reserve_account_id) ?? null : null;
        return {
          ...asset,
          owner: asset.owner_player_id ? players.get(asset.owner_player_id) ?? null : null,
          originalBuyer: asset.original_buyer_player_id ? players.get(asset.original_buyer_player_id) ?? null : null,
          operation: backingOperation ?? originOperation,
          originOperation,
          backingOperation,
          backingAllocation: allocation ? {
            id: allocation.id,
            status: allocation.status,
            referenceUsdValue: Number(allocation.reference_usd_value),
            allocatedAt: allocation.allocated_at,
            releasedAt: allocation.released_at,
            reserveAccount: reserveAccount ? {
              id: reserveAccount.id,
              name: reserveAccount.name,
              provider: reserveAccount.provider,
              accountType: reserveAccount.account_type,
              currency: reserveAccount.currency,
              status: reserveAccount.status,
              isActive: reserveAccount.is_active,
              authorizedForFlow: reserveAccount.authorized_for_flow,
            } : null,
          } : null,
          history: movementsByAsset.get(asset.id) ?? [],
        };
      }),
    }, { headers: { "cache-control": "private, no-store, max-age=0" } });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron cargar tus FLOWS." }, { status });
  }
}
