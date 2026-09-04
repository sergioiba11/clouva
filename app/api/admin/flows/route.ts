import { NextRequest, NextResponse } from "next/server";
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

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(
      {
        error: "Los FLOWS no se ajustan manualmente. Para acreditar FLOW registrá una operación económica real.",
        cashPaymentHref: "/admin/flows/pagos-manuales",
      },
      { status: 405 },
    );
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No autorizado." }, { status });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireAdmin(request);
    const userId = request.nextUrl.searchParams.get("userId");
    if (!userId) return NextResponse.json({ error: "Falta userId." }, { status: 400 });

    const [{ data: wallet, error: walletError }, { data: entries, error: entriesError }] = await Promise.all([
      admin.from("flows_wallets").select("balance,updated_at").eq("user_id", userId).maybeSingle(),
      admin.from("flows_wallet_ledger").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(50),
    ]);
    if (walletError) throw new Error(walletError.message);
    if (entriesError) throw new Error(entriesError.message);

    return NextResponse.json({ balance: wallet?.balance ?? 0, ledger: entries ?? [] });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo cargar el saldo de FLOWS.";
    return NextResponse.json({ error: message }, { status });
  }
}
