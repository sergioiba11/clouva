"use client";

import { useEffect, useMemo, useState } from "react";
import { PremiumCard, StatCard } from "@/components/os-ui";

type BookingRow = {
  id: string;
  buyer_id: string;
  scheduled_at: string;
  duration_minutes: number;
  status: string;
  price: number | null;
  currency: string;
  payment_status: string;
  created_at: string;
  studio_services: { name: string } | null;
  studios: { name: string; slug: string } | null;
};

type ProfileLite = { id: string; full_name: string | null; username: string | null };

const money = (value: number, currency = "ARS") => new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const when = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

const STATUS_LABEL: Record<string, string> = {
  requested: "Solicitada",
  confirmed: "Confirmada",
  completed: "Completada",
  cancelled: "Cancelada",
};

const STATUS_STYLE: Record<string, string> = {
  requested: "text-amber-300",
  confirmed: "text-emerald-300",
  completed: "text-white/60",
  cancelled: "text-red-300",
};

export default function ReservasAdminPage() {
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      const { supabase } = await import("@/lib/supabase");
      const { data, error: bookingsError } = await supabase
        .from("bookings")
        .select("id,buyer_id,scheduled_at,duration_minutes,status,price,currency,payment_status,created_at,studio_services(name),studios(name,slug)")
        .order("scheduled_at", { ascending: false })
        .limit(300);

      if (bookingsError) {
        setError(bookingsError.message);
        setLoading(false);
        return;
      }

      const bookings = (data ?? []) as unknown as BookingRow[];
      const buyerIds = Array.from(new Set(bookings.map((b) => b.buyer_id)));
      const { data: profileRows } = buyerIds.length
        ? await supabase.from("profiles").select("id,full_name,username").in("id", buyerIds)
        : { data: [] as ProfileLite[] };

      setProfiles(Object.fromEntries((profileRows ?? []).map((p) => [p.id, p])));
      setRows(bookings);
      setLoading(false);
    })();
  }, []);

  const stats = useMemo(() => {
    const requested = rows.filter((r) => r.status === "requested").length;
    const confirmed = rows.filter((r) => r.status === "confirmed").length;
    const completed = rows.filter((r) => r.status === "completed").length;
    const revenue = rows.filter((r) => r.payment_status === "paid").reduce((sum, r) => sum + Number(r.price || 0), 0);
    return { requested, confirmed, completed, revenue };
  }, [rows]);

  return (
    <div className="space-y-4">
      <PremiumCard className="p-6">
        <h1 className="text-2xl font-bold">Reservas</h1>
        <p className="mt-1 text-sm text-white/50">Reservas reales de servicios de Estudio (bookings). Los managers confirman/cancelan desde el panel del Estudio; acá solo se supervisa.</p>
      </PremiumCard>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Por confirmar" value={loading ? "…" : stats.requested} />
        <StatCard label="Confirmadas" value={loading ? "…" : stats.confirmed} />
        <StatCard label="Completadas" value={loading ? "…" : stats.completed} />
        <StatCard label="Ingresos cobrados" value={loading ? "…" : money(stats.revenue)} />
      </div>

      {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}

      <PremiumCard className="p-5">
        {loading ? <p className="text-sm text-white/50">Cargando reservas…</p> : null}
        {!loading && rows.length === 0 ? <p className="text-sm text-white/50">Todavía no hay reservas.</p> : null}
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.id} className="grid gap-2 rounded-xl border border-white/10 bg-black/20 p-3 text-sm md:grid-cols-6 md:items-center">
              <span>{profiles[row.buyer_id]?.full_name || profiles[row.buyer_id]?.username || row.buyer_id.slice(0, 8)}</span>
              <span className="text-white/60">{row.studio_services?.name ?? "Servicio"} · {row.studios?.name ?? "Estudio"}</span>
              <span className="text-xs text-white/40">{when(row.scheduled_at)} · {row.duration_minutes}min</span>
              <span>{row.price ? money(row.price, row.currency) : "A consultar"}</span>
              <span className="text-white/50">{row.payment_status === "not_required" ? "sin pago" : row.payment_status}</span>
              <span className={STATUS_STYLE[row.status] ?? "text-white/50"}>{STATUS_LABEL[row.status] ?? row.status}</span>
            </div>
          ))}
        </div>
      </PremiumCard>
    </div>
  );
}
