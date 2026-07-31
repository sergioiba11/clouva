"use client";

import { useEffect, useMemo, useState } from "react";
import { PremiumCard, StatCard } from "@/components/os-ui";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type WalletRow = { user_id: string; balance: number; updated_at: string };
type ProfileLite = { id: string; full_name: string | null; username: string | null };
type LedgerEntry = { id: string; transaction_type: string; amount: number; balance_after: number; source: string | null; created_at: string };

const when = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function FlowsAdminPage() {
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { supabase } = await import("@/lib/supabase");
    const { data, error: walletsError } = await supabase.from("flows_wallets").select("user_id,balance,updated_at").order("balance", { ascending: false }).limit(200);
    if (walletsError) {
      setError(walletsError.message);
      setLoading(false);
      return;
    }
    const rows = (data ?? []) as WalletRow[];
    const userIds = rows.map((r) => r.user_id);
    const { data: profileRows } = userIds.length ? await supabase.from("profiles").select("id,full_name,username").in("id", userIds) : { data: [] as ProfileLite[] };
    setProfiles(Object.fromEntries((profileRows ?? []).map((p) => [p.id, p])));
    setWallets(rows);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const totalBalance = useMemo(() => wallets.reduce((sum, w) => sum + w.balance, 0), [wallets]);

  const openLedger = async (userId: string) => {
    setSelectedUserId(userId);
    setLedgerLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/admin/flows?userId=${userId}`);
      const payload = await readApiJson<{ balance: number; ledger: LedgerEntry[] }>(response);
      setLedger(payload.ledger);
    } catch (ledgerError) {
      setError(ledgerError instanceof Error ? ledgerError.message : "No se pudo cargar el historial.");
    } finally {
      setLedgerLoading(false);
    }
  };

  const submitAdjustment = async () => {
    if (!selectedUserId) return;
    const amount = Number(adjustAmount);
    if (!Number.isFinite(amount) || amount === 0) {
      setError("Ingresá un monto entero distinto de cero.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/admin/flows", {
        method: "POST",
        body: JSON.stringify({ userId: selectedUserId, amount, reason: adjustReason }),
      });
      await readApiJson(response);
      setAdjustAmount("");
      setAdjustReason("");
      await Promise.all([load(), openLedger(selectedUserId)]);
    } catch (adjustError) {
      setError(adjustError instanceof Error ? adjustError.message : "No se pudo ajustar el saldo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PremiumCard className="p-6">
        <h1 className="text-2xl font-bold">Flows</h1>
        <p className="mt-1 text-sm text-white/50">Moneda interna de CLOUVA (flows_wallets / flows_wallet_ledger, ledger inmutable). Hoy el único movimiento real es el ajuste manual de admin — todavía no hay gasto automático en generaciones de IA, ropa de Avatar ni compras del Marketplace conectado a este saldo.</p>
      </PremiumCard>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Saldo total en circulación" value={loading ? "…" : totalBalance.toLocaleString("es-AR")} />
        <StatCard label="Wallets con saldo" value={loading ? "…" : wallets.filter((w) => w.balance > 0).length} />
        <StatCard label="Wallets totales" value={loading ? "…" : wallets.length} />
      </div>

      {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <PremiumCard className="p-5">
          <h3 className="text-sm uppercase tracking-[0.16em] text-white/50">Saldos</h3>
          {loading ? <p className="mt-3 text-sm text-white/50">Cargando…</p> : null}
          {!loading && wallets.length === 0 ? <p className="mt-3 text-sm text-white/50">Nadie tiene saldo de Flows todavía.</p> : null}
          <div className="mt-3 space-y-2">
            {wallets.map((wallet) => (
              <button
                key={wallet.user_id}
                onClick={() => void openLedger(wallet.user_id)}
                className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition ${selectedUserId === wallet.user_id ? "border-violet-400/40 bg-violet-400/10" : "border-white/10 bg-black/20 hover:bg-white/[0.04]"}`}
              >
                <span>{profiles[wallet.user_id]?.full_name || profiles[wallet.user_id]?.username || wallet.user_id.slice(0, 8)}</span>
                <span className="font-semibold">{wallet.balance.toLocaleString("es-AR")} flows</span>
              </button>
            ))}
          </div>
        </PremiumCard>

        <PremiumCard className="p-5">
          <h3 className="text-sm uppercase tracking-[0.16em] text-white/50">Historial y ajuste manual</h3>
          {!selectedUserId ? (
            <p className="mt-3 text-sm text-white/50">Elegí un usuario de la lista para ver su historial.</p>
          ) : (
            <>
              <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
                {ledgerLoading ? <p className="text-sm text-white/50">Cargando historial…</p> : null}
                {!ledgerLoading && ledger.length === 0 ? <p className="text-sm text-white/50">Sin movimientos.</p> : null}
                {ledger.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-1.5 text-xs">
                    <span className="text-white/60">{entry.transaction_type} · {when(entry.created_at)}</span>
                    <span className={entry.amount > 0 ? "text-emerald-300" : "text-red-300"}>{entry.amount > 0 ? "+" : ""}{entry.amount} → {entry.balance_after}</span>
                  </div>
                ))}
              </div>

              <div className="mt-4 space-y-2 border-t border-white/10 pt-4">
                <p className="text-xs text-white/50">Ajuste manual (positivo = acreditar, negativo = debitar)</p>
                <div className="flex gap-2">
                  <input type="number" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} placeholder="Monto" className="w-28 rounded-lg border border-white/15 bg-transparent px-3 py-1.5 text-sm" />
                  <input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="Motivo (opcional)" className="flex-1 rounded-lg border border-white/15 bg-transparent px-3 py-1.5 text-sm" />
                </div>
                <button disabled={busy} onClick={() => void submitAdjustment()} className="rounded-lg bg-white px-4 py-1.5 text-sm font-semibold text-black disabled:opacity-50">
                  {busy ? "Aplicando…" : "Aplicar ajuste"}
                </button>
              </div>
            </>
          )}
        </PremiumCard>
      </div>
    </div>
  );
}
