import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MoneyLedgerRow = {
  id: string;
  beneficiary_user_id: string;
  beneficiary_type: "user" | "player" | "studio";
  beneficiary_entity_id: string;
  currency: string;
  source_type: "commerce_order" | "service_order" | "booking";
  source_id: string;
  gross_amount_minor: number;
  fees_amount_minor: number;
  commission_amount_minor: number;
  net_amount_minor: number;
  status: "pending" | "available" | "withdrawn" | "refunded" | "reversed";
  pending_at: string | null;
  available_at: string | null;
  withdrawn_at: string | null;
  refunded_at: string | null;
  reversed_at: string | null;
  created_at: string;
};

type CurrencySummary = {
  currency: string;
  generatedMinor: number;
  pendingMinor: number;
  availableMinor: number;
  withdrawnMinor: number;
  refundedMinor: number;
};

function summarize(rows: MoneyLedgerRow[]) {
  const map = new Map<string, CurrencySummary>();
  for (const row of rows) {
    const summary = map.get(row.currency) ?? {
      currency: row.currency,
      generatedMinor: 0,
      pendingMinor: 0,
      availableMinor: 0,
      withdrawnMinor: 0,
      refundedMinor: 0,
    };
    const amount = Number(row.net_amount_minor || 0);
    if (row.status === "pending") {
      summary.pendingMinor += amount;
      summary.generatedMinor += amount;
    } else if (row.status === "available") {
      summary.availableMinor += amount;
      summary.generatedMinor += amount;
    } else if (row.status === "withdrawn") {
      summary.withdrawnMinor += amount;
      summary.generatedMinor += amount;
    } else if (row.status === "refunded") {
      summary.refundedMinor += amount;
    }
    map.set(row.currency, summary);
  }
  return Array.from(map.values()).sort((a, b) => a.currency.localeCompare(b.currency));
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();

    const [
      flowsWallet,
      diamondWallet,
      flowsLedger,
      diamondLedger,
      personalMoney,
      ownedPlayers,
      playerMemberships,
      ownedStudios,
      studioMemberships,
    ] = await Promise.all([
      admin.from("flows_wallets").select("balance").eq("user_id", user.id).maybeSingle(),
      admin.from("diamond_wallets").select("balance").eq("user_id", user.id).maybeSingle(),
      admin.from("flows_wallet_ledger").select("id,transaction_type,amount,balance_after,source,reference_id,metadata,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
      admin.from("diamond_wallet_ledger").select("id,transaction_type,amount,balance_after,source,reference_id,metadata,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
      admin.from("mi_flow_money_ledger").select("id,beneficiary_user_id,beneficiary_type,beneficiary_entity_id,currency,source_type,source_id,gross_amount_minor,fees_amount_minor,commission_amount_minor,net_amount_minor,status,pending_at,available_at,withdrawn_at,refunded_at,reversed_at,created_at").eq("beneficiary_user_id", user.id).order("created_at", { ascending: false }).limit(200),
      admin.from("players").select("id,display_name,slug").eq("owner_user_id", user.id),
      admin.from("player_members").select("player_id,role,status").eq("user_id", user.id).eq("status", "active").in("role", ["owner", "manager"]),
      admin.from("studios").select("id,name,slug").eq("owner_id", user.id),
      admin.from("studio_members").select("studio_id,role,status").eq("profile_id", user.id).eq("status", "active").in("role", ["owner", "admin", "manager"]),
    ]);

    for (const result of [flowsWallet, diamondWallet, flowsLedger, diamondLedger, personalMoney, ownedPlayers, playerMemberships, ownedStudios, studioMemberships]) {
      if (result.error) throw new Error(result.error.message);
    }

    const managedPlayerIds = new Set<string>((ownedPlayers.data ?? []).map((row) => String(row.id)));
    for (const row of playerMemberships.data ?? []) managedPlayerIds.add(String(row.player_id));
    const managedStudioIds = new Set<string>((ownedStudios.data ?? []).map((row) => String(row.id)));
    for (const row of studioMemberships.data ?? []) managedStudioIds.add(String(row.studio_id));

    const managedFilters: string[] = [];
    if (managedPlayerIds.size) managedFilters.push(`and(beneficiary_type.eq.player,beneficiary_entity_id.in.(${Array.from(managedPlayerIds).join(",")}))`);
    if (managedStudioIds.size) managedFilters.push(`and(beneficiary_type.eq.studio,beneficiary_entity_id.in.(${Array.from(managedStudioIds).join(",")}))`);

    let managedMoneyRows: MoneyLedgerRow[] = [];
    if (managedFilters.length) {
      const managedQuery = await admin
        .from("mi_flow_money_ledger")
        .select("id,beneficiary_user_id,beneficiary_type,beneficiary_entity_id,currency,source_type,source_id,gross_amount_minor,fees_amount_minor,commission_amount_minor,net_amount_minor,status,pending_at,available_at,withdrawn_at,refunded_at,reversed_at,created_at")
        .or(managedFilters.join(","))
        .neq("beneficiary_user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (managedQuery.error) throw new Error(managedQuery.error.message);
      managedMoneyRows = (managedQuery.data ?? []) as MoneyLedgerRow[];
    }

    const personalRows = (personalMoney.data ?? []) as MoneyLedgerRow[];

    return NextResponse.json({
      wallets: {
        flows: flowsWallet.data?.balance ?? 0,
        diamonds: diamondWallet.data?.balance ?? 0,
      },
      walletActivity: {
        flows: flowsLedger.data ?? [],
        diamonds: diamondLedger.data ?? [],
      },
      money: {
        personal: summarize(personalRows),
        personalActivity: personalRows.slice(0, 40),
        // This section intentionally contains entity money only when the ledger
        // beneficiary is someone else. Merely managing a Spot never turns its
        // proceeds into the current user's personal balance.
        managed: summarize(managedMoneyRows),
        managedActivity: managedMoneyRows.slice(0, 40),
      },
      access: {
        players: Array.from(managedPlayerIds),
        studios: Array.from(managedStudioIds),
      },
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo cargar MI FLOW.";
    return NextResponse.json({ error: message }, { status });
  }
}
