import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Both wallets are just backend + this read today -- no store/achievements
// spend or grant either currency yet. Returns 0 for a user with no wallet
// row (adjust_*_balance only creates the row on first transaction).
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const [flowsResult, diamondResult] = await Promise.all([
      admin.from("flows_wallets").select("balance").eq("user_id", user.id).maybeSingle(),
      admin.from("diamond_wallets").select("balance").eq("user_id", user.id).maybeSingle(),
    ]);
    if (flowsResult.error) throw new Error(flowsResult.error.message);
    if (diamondResult.error) throw new Error(diamondResult.error.message);

    return NextResponse.json({
      flows: flowsResult.data?.balance ?? 0,
      diamonds: diamondResult.data?.balance ?? 0,
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo cargar el saldo.";
    return NextResponse.json({ error: message }, { status });
  }
}
