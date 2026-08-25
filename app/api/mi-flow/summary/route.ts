import { NextRequest, NextResponse } from "next/server";
import { getSpaceAdminEligibility } from "@/lib/server/space-access";
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
  metadata?: Record<string, unknown> | null;
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

type SpaceRow = {
  id: string;
  name: string;
  slug: string;
  type: string;
  owner_player_id: string;
  legacy_studio_id: string | null;
  legacy_commerce_spot_id: string | null;
};

const MONEY_SELECT = "id,beneficiary_user_id,beneficiary_type,beneficiary_entity_id,currency,source_type,source_id,gross_amount_minor,fees_amount_minor,commission_amount_minor,net_amount_minor,status,pending_at,available_at,withdrawn_at,refunded_at,reversed_at,metadata,created_at";
const FINANCE_ROLES = new Set(["owner", "admin", "manager", "finance"]);

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

function uniqueRows(rows: MoneyLedgerRow[]) {
  const map = new Map(rows.map((row) => [row.id, row]));
  return Array.from(map.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function rowBelongsToSpace(row: MoneyLedgerRow, space: SpaceRow) {
  if (space.legacy_studio_id && row.beneficiary_type === "studio" && row.beneficiary_entity_id === space.legacy_studio_id) {
    return true;
  }
  if (space.legacy_commerce_spot_id && row.metadata && String(row.metadata.spot_id || "") === space.legacy_commerce_spot_id) {
    return true;
  }
  return false;
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
      ownedPlayerResult,
      controlledMemberships,
      eligibility,
    ] = await Promise.all([
      admin.from("flows_wallets").select("balance").eq("user_id", user.id).maybeSingle(),
      admin.from("diamond_wallets").select("balance").eq("user_id", user.id).maybeSingle(),
      admin.from("flows_wallet_ledger").select("id,transaction_type,amount,balance_after,source,reference_id,metadata,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
      admin.from("diamond_wallet_ledger").select("id,transaction_type,amount,balance_after,source,reference_id,metadata,created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
      admin.from("players").select("id,display_name,slug").eq("owner_user_id", user.id).maybeSingle(),
      admin.from("player_members").select("player_id,role,status").eq("user_id", user.id).eq("status", "active").in("role", ["owner", "manager", "editor"]),
      getSpaceAdminEligibility({ admin, userId: user.id }),
    ]);

    for (const result of [flowsWallet, diamondWallet, flowsLedger, diamondLedger, ownedPlayerResult, controlledMemberships]) {
      if (result.error) throw new Error(result.error.message);
    }

    const ownedPlayer = ownedPlayerResult.data;
    const controlledPlayerIds = new Set<string>();
    if (ownedPlayer?.id) controlledPlayerIds.add(String(ownedPlayer.id));
    for (const row of controlledMemberships.data ?? []) controlledPlayerIds.add(String(row.player_id));

    const personalFilters = [`and(beneficiary_type.eq.user,beneficiary_entity_id.eq.${user.id})`];
    if (ownedPlayer?.id) {
      personalFilters.push(`and(beneficiary_type.eq.player,beneficiary_entity_id.eq.${ownedPlayer.id})`);
    }

    const personalMoney = await admin
      .from("mi_flow_money_ledger")
      .select(MONEY_SELECT)
      .or(personalFilters.join(","))
      .order("created_at", { ascending: false })
      .limit(300);
    if (personalMoney.error) throw new Error(personalMoney.error.message);
    const personalRows = (personalMoney.data ?? []) as MoneyLedgerRow[];

    let managedSpaces: Array<{
      id: string;
      name: string;
      slug: string;
      type: string;
      role: string;
      summary: CurrencySummary[];
      activity: MoneyLedgerRow[];
      adminHref: string;
      moneyRelation: "separate" | "personal_breakdown";
    }> = [];
    let managedRows: MoneyLedgerRow[] = [];

    if (eligibility.canAdministerSpaces && controlledPlayerIds.size) {
      const memberships = await admin
        .from("space_members")
        .select("space_id,player_id,role,status")
        .in("player_id", Array.from(controlledPlayerIds))
        .eq("status", "active");
      if (memberships.error) throw new Error(memberships.error.message);

      const financeMemberships = (memberships.data ?? []).filter((row) => FINANCE_ROLES.has(String(row.role)));
      const spaceIds = Array.from(new Set(financeMemberships.map((row) => String(row.space_id))));
      if (spaceIds.length) {
        const spacesResult = await admin
          .from("spaces")
          .select("id,name,slug,type,owner_player_id,legacy_studio_id,legacy_commerce_spot_id")
          .in("id", spaceIds)
          .neq("status", "archived");
        if (spacesResult.error) throw new Error(spacesResult.error.message);

        const spaces = (spacesResult.data ?? []) as SpaceRow[];
        const studioIds = spaces.flatMap((space) => space.legacy_studio_id ? [space.legacy_studio_id] : []);
        const playerIds = Array.from(new Set(spaces.map((space) => space.owner_player_id)));
        const managedFilters: string[] = [];
        if (studioIds.length) managedFilters.push(`and(beneficiary_type.eq.studio,beneficiary_entity_id.in.(${studioIds.join(",")}))`);
        if (playerIds.length) managedFilters.push(`and(beneficiary_type.eq.player,beneficiary_entity_id.in.(${playerIds.join(",")}))`);

        let candidateRows: MoneyLedgerRow[] = [];
        if (managedFilters.length) {
          const result = await admin
            .from("mi_flow_money_ledger")
            .select(MONEY_SELECT)
            .or(managedFilters.join(","))
            .order("created_at", { ascending: false })
            .limit(500);
          if (result.error) throw new Error(result.error.message);
          candidateRows = (result.data ?? []) as MoneyLedgerRow[];
        }

        managedSpaces = spaces.map((space) => {
          const membership = financeMemberships.find((row) => String(row.space_id) === space.id);
          const rows = candidateRows.filter((row) => rowBelongsToSpace(row, space));
          const personalBreakdown = Boolean(ownedPlayer?.id && space.owner_player_id === ownedPlayer.id && !space.legacy_studio_id);
          if (!personalBreakdown) managedRows.push(...rows);
          const adminHref = space.legacy_studio_id
            ? `/studio-dashboard?studio=${space.legacy_studio_id}`
            : space.legacy_commerce_spot_id
              ? `/mi-spot/${space.legacy_commerce_spot_id}`
              : `/mi-spot`;
          return {
            id: space.id,
            name: space.name,
            slug: space.slug,
            type: space.type,
            role: String(membership?.role || "viewer"),
            summary: summarize(rows),
            activity: rows.slice(0, 20),
            adminHref,
            moneyRelation: personalBreakdown ? "personal_breakdown" as const : "separate" as const,
          };
        });
      }
    }

    managedRows = uniqueRows(managedRows);

    return NextResponse.json({
      player: ownedPlayer ?? null,
      plan: {
        isVip: eligibility.isVip,
        canAdministerSpaces: eligibility.canAdministerSpaces,
      },
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
        managed: summarize(managedRows),
        managedActivity: managedRows.slice(0, 40),
      },
      spaces: managedSpaces,
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo cargar MI FLOW.";
    return NextResponse.json({ error: message }, { status });
  }
}
