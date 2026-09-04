import "server-only";

import { signedDirection } from "@/lib/agenda/participation-policy";
import { createAdminSupabase } from "@/lib/server/supabase";

type AdminClient = ReturnType<typeof createAdminSupabase>;

export type AgendaTimelineItem = {
  id: string;
  type: "financial" | "flow" | "diamond";
  occurredAt: string;
  source: string;
  title: string;
  amount: number;
  currency: string;
  direction: "credit" | "debit";
  referenceId: string | null;
  metadata: Record<string, unknown>;
};

type MoneyRow = {
  id: string;
  currency: string;
  source_type: string;
  source_id: string;
  net_amount_minor: number;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type WalletRow = {
  id: string;
  transaction_type: string;
  amount: number;
  source: string | null;
  reference_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

function asRangeIso(value: string, field: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${field} inválido.`);
  return date.toISOString();
}

function metadataSource(metadata: Record<string, unknown>, fallback: string) {
  const values = [metadata.payment_provider, metadata.provider, metadata.wallet, metadata.source];
  const value = values.find((entry) => typeof entry === "string" && entry.trim());
  return typeof value === "string" ? value.trim() : fallback;
}

function moneyTitle(row: MoneyRow) {
  const metadata = row.metadata || {};
  const explicit = [metadata.title, metadata.description, metadata.merchant_name, metadata.store_name]
    .find((entry) => typeof entry === "string" && entry.trim());
  if (typeof explicit === "string") return explicit.trim();
  const labels: Record<string, string> = {
    commerce_order: "Venta / compra registrada",
    service_order: "Servicio",
    booking: "Reserva",
  };
  return labels[row.source_type] || "Movimiento económico";
}

function flowTitle(transactionType: string) {
  const labels: Record<string, string> = {
    purchase: "Compra de FLOWS",
    reward: "Recompensa de FLOWS",
    refund: "Reintegro de FLOWS",
    ai_usage: "Uso de CLOUVA AI",
    avatar_purchase: "Compra para avatar",
    marketplace_purchase: "Compra en Market",
    admin_adjustment: "Ajuste de FLOWS",
    promotional_credit: "Crédito promocional",
    issuance: "Emisión de FLOWS",
    transfer: "Transferencia de FLOWS",
  };
  return labels[transactionType] || transactionType.replaceAll("_", " ");
}

function walletAdapter(rows: WalletRow[], type: "flow" | "diamond", currency: "FLOW" | "DIAMOND") {
  return rows.map<AgendaTimelineItem>((row) => ({
    id: `${type}:${row.id}`,
    type,
    occurredAt: row.created_at,
    source: row.source || (type === "flow" ? "Mi Flow" : "CLOUVA"),
    title: type === "flow" ? flowTitle(row.transaction_type) : "Movimiento de Diamonds",
    amount: Number(row.amount || 0),
    currency,
    direction: signedDirection(Number(row.amount || 0)),
    referenceId: row.reference_id || null,
    metadata: row.metadata || {},
  }));
}

export async function getAgendaFinancialTimeline(args: {
  admin: AdminClient;
  userId: string;
  from: string;
  to: string;
}): Promise<AgendaTimelineItem[]> {
  const from = asRangeIso(args.from, "Desde");
  const to = asRangeIso(args.to, "Hasta");
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  if (toMs <= fromMs) throw new Error("El rango de la línea temporal es inválido.");
  if (toMs - fromMs > 400 * 86_400_000) throw new Error("El rango máximo de la línea temporal es 400 días.");

  const [moneyResult, flowsResult, diamondsResult] = await Promise.all([
    args.admin
      .from("mi_flow_money_ledger")
      .select("id,currency,source_type,source_id,net_amount_minor,status,metadata,created_at")
      .eq("beneficiary_user_id", args.userId)
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at", { ascending: true })
      .limit(1000),
    args.admin
      .from("flows_wallet_ledger")
      .select("id,transaction_type,amount,source,reference_id,metadata,created_at")
      .eq("user_id", args.userId)
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at", { ascending: true })
      .limit(1000),
    args.admin
      .from("diamond_wallet_ledger")
      .select("id,transaction_type,amount,source,reference_id,metadata,created_at")
      .eq("user_id", args.userId)
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at", { ascending: true })
      .limit(1000),
  ]);

  for (const result of [moneyResult, flowsResult, diamondsResult]) {
    if (result.error) throw new Error(result.error.message);
  }

  const money = ((moneyResult.data ?? []) as MoneyRow[]).map<AgendaTimelineItem>((row) => {
    const metadata = row.metadata || {};
    const refunded = row.status === "refunded" || row.status === "reversed";
    const baseAmount = Math.abs(Number(row.net_amount_minor || 0)) / 100;
    const amount = refunded ? -baseAmount : baseAmount;
    return {
      id: `money:${row.id}`,
      type: "financial",
      occurredAt: row.created_at,
      source: metadataSource(metadata, row.source_type === "commerce_order" ? "Mi Flow" : row.source_type),
      title: moneyTitle(row),
      amount,
      currency: row.currency,
      direction: signedDirection(amount),
      referenceId: row.source_id || null,
      metadata: { ...metadata, status: row.status, sourceType: row.source_type },
    };
  });

  const items = [
    ...money,
    ...walletAdapter((flowsResult.data ?? []) as WalletRow[], "flow", "FLOW"),
    ...walletAdapter((diamondsResult.data ?? []) as WalletRow[], "diamond", "DIAMOND"),
  ];

  return items.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}
