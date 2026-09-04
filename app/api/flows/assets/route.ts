import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FundingRow = {
  id: string;
  operation_id: string;
  entry_type: string;
  provider: string | null;
  payment_method: string | null;
  amount: number;
  currency: string;
  status: string;
  external_payment_id: string | null;
  occurred_at: string;
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

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();

    const [{ data: assets, error: assetsError }, { data: pricing, error: pricingError }] = await Promise.all([
      admin
        .from("flow_assets")
        .select("id,flow_number,status,issued_at,activated_at,owner_player_id,original_buyer_player_id,operation_id")
        .eq("owner_user_id", user.id)
        .order("flow_number", { ascending: true }),
      admin.from("flow_issuance_settings").select("flow_usd_value").eq("id", "canonical").single(),
    ]);
    if (assetsError) throw new Error(assetsError.message);
    if (pricingError) throw new Error(pricingError.message);

    const operationIds = [...new Set((assets ?? []).map((row) => row.operation_id))];
    const assetIds = (assets ?? []).map((row) => row.id);
    const playerIds = [...new Set((assets ?? []).flatMap((row) => [row.owner_player_id, row.original_buyer_player_id].filter(Boolean) as string[]))];

    const [operationsResult, playersResult, fundingResult, documentsResult, movementsResult] = await Promise.all([
      operationIds.length
        ? admin
            .from("flow_purchase_operations")
            .select("id,provider,provider_payment_id,provider_reference,payment_method,quantity,unit_usd,amount,currency,status,backing_status,confirmed_at,issued_at,created_at,fx_rate_original_per_usd,fx_source,fx_quoted_at,refund_status")
            .in("id", operationIds)
        : Promise.resolve({ data: [], error: null }),
      playerIds.length
        ? admin.from("players").select("id,display_name,slug").in("id", playerIds)
        : Promise.resolve({ data: [], error: null }),
      operationIds.length
        ? admin
            .from("flow_funding_ledger")
            .select("id,operation_id,entry_type,provider,payment_method,amount,currency,status,external_payment_id,occurred_at")
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
    ]);
    for (const result of [operationsResult, playersResult, fundingResult, documentsResult, movementsResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const operations = new Map((operationsResult.data ?? []).map((row) => [row.id, row]));
    const players = new Map((playersResult.data ?? []).map((row) => [row.id, row]));
    const fundingByOperation = new Map<string, FundingRow[]>();
    for (const row of (fundingResult.data ?? []) as FundingRow[]) {
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

    return NextResponse.json({
      pricing: { flowUsdValue: Number(pricing.flow_usd_value), currency: "USD" },
      assets: (assets ?? []).map((asset) => {
        const operation = operations.get(asset.operation_id) ?? null;
        return {
          ...asset,
          owner: asset.owner_player_id ? players.get(asset.owner_player_id) ?? null : null,
          originalBuyer: asset.original_buyer_player_id ? players.get(asset.original_buyer_player_id) ?? null : null,
          operation: operation
            ? {
                ...operation,
                funding: fundingByOperation.get(operation.id) ?? [],
                documents: documentsByOperation.get(operation.id) ?? [],
              }
            : null,
          history: movementsByAsset.get(asset.id) ?? [],
        };
      }),
    }, { headers: { "cache-control": "private, no-store, max-age=0" } });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron cargar tus FLOWS." }, { status });
  }
}
