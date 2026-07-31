"use client";

import { useEffect, useMemo, useState } from "react";
import { PremiumCard, StatCard } from "@/components/os-ui";

type SubscriptionRow = {
  id: string;
  user_id: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  created_at: string;
  billing_products: { name: string; code: string } | null;
  billing_prices: { amount: number; currency: string; billing_interval: string } | null;
};

type ProfileLite = { id: string; full_name: string | null; username: string | null; email: string | null };

const money = (value: number, currency = "ARS") => new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" }) : "—");

const STATUS_LABEL: Record<string, string> = {
  created: "Creada",
  authorized: "Activa",
  active: "Activa",
  paused: "Pausada",
  cancelled: "Cancelada",
  expired: "Vencida",
};

export default function SuscripcionesAdminPage() {
  const [rows, setRows] = useState<SubscriptionRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      const { supabase } = await import("@/lib/supabase");
      const { data, error: subsError } = await supabase
        .from("billing_subscriptions")
        .select("id,user_id,status,current_period_start,current_period_end,cancel_at_period_end,cancelled_at,created_at,billing_products(name,code),billing_prices(amount,currency,billing_interval)")
        .order("created_at", { ascending: false })
        .limit(500);

      if (subsError) {
        setError(subsError.message);
        setLoading(false);
        return;
      }

      const subs = (data ?? []) as unknown as SubscriptionRow[];
      const userIds = Array.from(new Set(subs.map((s) => s.user_id)));
      const { data: profileRows } = userIds.length
        ? await supabase.from("profiles").select("id,full_name,username,email").in("id", userIds)
        : { data: [] as ProfileLite[] };

      setProfiles(Object.fromEntries((profileRows ?? []).map((p) => [p.id, p])));
      setRows(subs);
      setLoading(false);
    })();
  }, []);

  const stats = useMemo(() => {
    const active = rows.filter((r) => r.status === "authorized" || r.status === "active");
    const mrr = active.reduce((sum, r) => {
      const price = r.billing_prices;
      if (!price) return sum;
      const monthly = price.billing_interval === "year" ? price.amount / 12 : price.amount;
      return sum + monthly;
    }, 0);
    const cancelling = active.filter((r) => r.cancel_at_period_end).length;
    return { activeCount: active.length, mrr, cancelling, total: rows.length };
  }, [rows]);

  return (
    <div className="space-y-4">
      <PremiumCard className="p-6">
        <h1 className="text-2xl font-bold">Suscripciones</h1>
        <p className="mt-1 text-sm text-white/50">Planes recurrentes reales (billing_subscriptions), confirmados por Mercado Pago. Hoy solo existe CLOUVA VIP como producto activo — Player Pro / Studio / Studio Pro todavía no están cargados en billing_products.</p>
      </PremiumCard>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Activas" value={loading ? "…" : stats.activeCount} />
        <StatCard label="MRR estimado" value={loading ? "…" : money(stats.mrr)} />
        <StatCard label="Por cancelar (fin de período)" value={loading ? "…" : stats.cancelling} />
        <StatCard label="Total histórico" value={loading ? "…" : stats.total} />
      </div>

      {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}

      <PremiumCard className="p-5">
        {loading ? <p className="text-sm text-white/50">Cargando suscripciones…</p> : null}
        {!loading && rows.length === 0 ? <p className="text-sm text-white/50">Todavía no hay suscripciones.</p> : null}
        <div className="space-y-2">
          {rows.map((row) => {
            const profile = profiles[row.user_id];
            const price = row.billing_prices;
            return (
              <div key={row.id} className="grid gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-sm md:grid-cols-6 md:items-center">
                <span>{profile?.full_name || profile?.username || profile?.email || row.user_id.slice(0, 8)}</span>
                <span className="text-white/60">{row.billing_products?.name ?? "—"}</span>
                <span>{price ? `${money(price.amount, price.currency)} / ${price.billing_interval === "year" ? "año" : "mes"}` : "—"}</span>
                <span className={row.status === "authorized" || row.status === "active" ? "text-emerald-300" : "text-white/50"}>
                  {STATUS_LABEL[row.status] ?? row.status}{row.cancel_at_period_end ? " · no renueva" : ""}
                </span>
                <span className="text-xs text-white/40">Vence {when(row.current_period_end)}</span>
                <span className="text-xs text-white/40">Desde {when(row.created_at)}</span>
              </div>
            );
          })}
        </div>
      </PremiumCard>
    </div>
  );
}
