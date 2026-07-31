import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only real write path for Flows right now: an admin manually crediting or
// debiting a user's balance (transaction_type admin_adjustment/promotional_credit).
// Spending Flows on AI generations, avatar items, etc. is not wired up yet --
// this ships the ledger + atomic balance function, not the whole spend
// pipeline. Said explicitly here so it isn't mistaken for done.
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
    const body = (await request.json().catch(() => ({}))) as { userId?: string; amount?: number; reason?: string };
    const amount = Math.trunc(Number(body.amount));
    if (!body.userId || !Number.isFinite(amount) || amount === 0) {
      return NextResponse.json({ error: "Falta userId o amount (entero distinto de cero)." }, { status: 400 });
    }

    const { data: ledgerEntry, error } = await admin.rpc("adjust_flows_balance", {
      p_user_id: body.userId,
      p_amount: amount,
      p_transaction_type: amount > 0 ? "promotional_credit" : "admin_adjustment",
      p_source: "admin_panel",
      p_reference_id: null,
      p_metadata: { reason: body.reason?.trim().slice(0, 500) || null },
      p_created_by: adminUser.id,
    });
    if (error) throw new Error(error.message);

    return NextResponse.json({ ledgerEntry });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo ajustar el saldo de Flows.";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireAdmin(request);
    const userId = request.nextUrl.searchParams.get("userId");
    if (!userId) return NextResponse.json({ error: "Falta userId." }, { status: 400 });

    const [{ data: wallet, error: walletError }, { data: entries, error: entriesError }] = await Promise.all([
      admin.from("flows_wallets").select("balance,updated_at").eq("user_id", userId).maybeSingle(),
      admin.from("flows_wallet_ledger").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(20),
    ]);
    if (walletError) throw new Error(walletError.message);
    if (entriesError) throw new Error(entriesError.message);

    return NextResponse.json({ balance: wallet?.balance ?? 0, ledger: entries ?? [] });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo cargar el saldo de Flows.";
    return NextResponse.json({ error: message }, { status });
  }
}
