import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const { data: assets, error } = await admin
      .from("flow_assets")
      .select("id,flow_number,status,issued_at,activated_at,owner_player_id,original_buyer_player_id,operation_id")
      .eq("owner_user_id", user.id)
      .order("flow_number", { ascending: true });
    if (error) throw new Error(error.message);

    const operationIds = [...new Set((assets ?? []).map((row) => row.operation_id))];
    const playerIds = [...new Set((assets ?? []).flatMap((row) => [row.owner_player_id, row.original_buyer_player_id].filter(Boolean) as string[]))];
    const [operationsResult, playersResult] = await Promise.all([
      operationIds.length
        ? admin.from("flow_purchase_operations").select("id,provider,payment_method,amount,currency,confirmed_at,created_at").in("id", operationIds)
        : Promise.resolve({ data: [], error: null }),
      playerIds.length
        ? admin.from("players").select("id,display_name,slug").in("id", playerIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (operationsResult.error) throw new Error(operationsResult.error.message);
    if (playersResult.error) throw new Error(playersResult.error.message);

    const operations = new Map((operationsResult.data ?? []).map((row) => [row.id, row]));
    const players = new Map((playersResult.data ?? []).map((row) => [row.id, row]));

    return NextResponse.json({
      assets: (assets ?? []).map((asset) => ({
        ...asset,
        owner: asset.owner_player_id ? players.get(asset.owner_player_id) ?? null : null,
        originalBuyer: asset.original_buyer_player_id ? players.get(asset.original_buyer_player_id) ?? null : null,
        operation: operations.get(asset.operation_id) ?? null,
      })),
    }, { headers: { "cache-control": "private, no-store, max-age=0" } });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron cargar tus FLOWS." }, { status });
  }
}
