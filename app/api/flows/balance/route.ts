import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { FLOW_USD_VALUE, flowsToUsd, getFlowRegion, normalizeFlowBalance } from "@/lib/flows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();

    const [walletResult, profileResult, playerResult] = await Promise.all([
      admin.from("flows_wallets").select("balance,updated_at").eq("user_id", user.id).maybeSingle(),
      admin.from("profiles").select("city").eq("id", user.id).maybeSingle(),
      admin
        .from("players")
        .select("location,origin")
        .eq("owner_user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    for (const result of [walletResult, profileResult, playerResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    const balance = normalizeFlowBalance(walletResult.data?.balance ?? 0);
    const region = getFlowRegion(
      playerResult.data?.location ?? null,
      playerResult.data?.origin ?? null,
      profileResult.data?.city ?? null,
    );

    return NextResponse.json(
      {
        balance,
        usdValue: flowsToUsd(balance),
        unitUsd: FLOW_USD_VALUE,
        currency: "USD",
        region,
        location: playerResult.data?.location ?? profileResult.data?.city ?? playerResult.data?.origin ?? null,
        updatedAt: walletResult.data?.updated_at ?? null,
      },
      { headers: { "cache-control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo cargar el saldo de FLOWS.";
    return NextResponse.json({ error: message }, { status });
  }
}
