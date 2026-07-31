"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ActivityFeed, PremiumCard, StatCard } from "@/components/os-ui";
import { OfficialAvatarRigCard } from "@/components/admin/OfficialAvatarRigCard";
import { useAuth } from "@/components/auth-provider";

const OWNER_EMAIL = "esian0116@gmail.com";

const money = (value: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value);
const when = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

type Stats = {
  ingresos: number;
  ingresosVip: number;
  ingresosServicios: number;
  suscripcionesActivas: number;
  usuariosVip: number;
  usuariosTotales: number;
  players: string;
  estudios: string;
};

export default function AdminPage() {
  const { role, user, loading, profileReady } = useAuth();
  const [stats, setStats] = useState<Stats>({ ingresos: 0, ingresosVip: 0, ingresosServicios: 0, suscripcionesActivas: 0, usuariosVip: 0, usuariosTotales: 0, players: "0/0", estudios: "0/0" });
  const [activity, setActivity] = useState<string[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);

  const allowed = role === "admin" || (user?.email || "").toLowerCase() === OWNER_EMAIL;

  useEffect(() => {
    if (loading || !profileReady || !allowed) return;

    void (async () => {
      setLoadingStats(true);
      const { supabase } = await import("@/lib/supabase");

      const [
        profilesCount,
        playersTotal,
        playersPublished,
        studiosTotal,
        studiosPublished,
        activeSubs,
        vipEntitlements,
        payments,
        serviceOrders,
      ] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("players").select("id", { count: "exact", head: true }),
        supabase.from("players").select("id", { count: "exact", head: true }).eq("is_published", true),
        supabase.from("studios").select("id", { count: "exact", head: true }),
        supabase.from("studios").select("id", { count: "exact", head: true }).eq("is_published", true),
        supabase.from("billing_subscriptions").select("id", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("user_entitlements").select("user_id,valid_until").eq("tier", "vip").eq("status", "active"),
        // Bounded but generous -- this sums client-side (same pattern as the
        // existing /admin/ventas dashboard), so it needs every real row, not
        // just a "recent activity" slice. Revisit with a server-side sum once
        // volume could plausibly exceed this.
        supabase.from("billing_payments").select("amount,currency,paid_at,user_id").order("paid_at", { ascending: false }).limit(1000),
        supabase.from("service_orders").select("total_amount,currency,updated_at,user_id,studio_id").eq("payment_status", "paid").order("updated_at", { ascending: false }).limit(1000),
      ]);

      const now = Date.now();
      const realVipUserIds = new Set(
        (vipEntitlements.data ?? [])
          .filter((row) => !row.valid_until || new Date(row.valid_until as string).getTime() > now)
          .map((row) => row.user_id as string),
      );

      const paymentRows = payments.data ?? [];
      const serviceOrderRows = serviceOrders.data ?? [];
      const ingresosVip = paymentRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const ingresosServicios = serviceOrderRows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);

      const userIds = Array.from(new Set([...paymentRows.map((r) => r.user_id), ...serviceOrderRows.map((r) => r.user_id)])) as string[];
      const { data: buyers } = userIds.length > 0
        ? await supabase.from("profiles").select("id,full_name,username").in("id", userIds)
        : { data: [] as Array<{ id: string; full_name: string | null; username: string | null }> };
      const nameOf = (id: string) => {
        const buyer = buyers?.find((b) => b.id === id);
        return buyer?.full_name || buyer?.username || "Alguien";
      };

      const feed = [
        ...paymentRows.map((row) => ({ at: row.paid_at as string, text: `${nameOf(row.user_id as string)} pagó ${money(Number(row.amount || 0))} · CLOUVA VIP` })),
        ...serviceOrderRows.map((row) => ({ at: row.updated_at as string, text: `${nameOf(row.user_id as string)} pagó ${money(Number(row.total_amount || 0))} · Servicio de Estudio` })),
      ]
        .filter((item) => item.at)
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 8)
        .map((item) => `${item.text} · ${when(item.at)}`);

      setStats({
        ingresos: ingresosVip + ingresosServicios,
        ingresosVip,
        ingresosServicios,
        suscripcionesActivas: activeSubs.count ?? 0,
        usuariosVip: realVipUserIds.size,
        usuariosTotales: profilesCount.count ?? 0,
        players: `${playersPublished.count ?? 0}/${playersTotal.count ?? 0}`,
        estudios: `${studiosPublished.count ?? 0}/${studiosTotal.count ?? 0}`,
      });
      setActivity(feed.length > 0 ? feed : ["Todavía no hay pagos registrados."]);
      setLoadingStats(false);
    })();
  }, [allowed, loading, profileReady]);

  if (loading || !profileReady) {
    return <div className="grid min-h-[60vh] place-items-center text-sm text-white/50">Verificando acceso…</div>;
  }

  if (!allowed) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-rose-400/20 bg-rose-400/10 p-6 text-white">
        <h1 className="text-xl font-semibold">Acceso restringido</h1>
        <p className="mt-2 text-sm text-white/60">Esta cuenta no tiene rol administrador.</p>
        <Link href="/mi-flow" className="mt-4 inline-block rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black">Volver a Mi Flow</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-admin-version="2026-07-14-rig">
      <PremiumCard className="p-6">
        <h1 className="text-3xl font-semibold">Centro de Control CLOUVA</h1>
        <p className="text-[var(--muted)]">Business OS · Analytics · Operación</p>
      </PremiumCard>

      <OfficialAvatarRigCard />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <StatCard label="Ingresos totales" value={loadingStats ? "…" : money(stats.ingresos)} />
        <StatCard label="Suscripciones VIP activas" value={stats.suscripcionesActivas} />
        <StatCard label="Usuarios VIP reales" value={stats.usuariosVip} />
        <StatCard label="Usuarios totales" value={stats.usuariosTotales} />
        <StatCard label="Players (publicados/total)" value={stats.players} />
        <StatCard label="Estudios (publicados/total)" value={stats.estudios} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PremiumCard className="p-5">
          <h3 className="text-sm uppercase tracking-[0.16em] text-[var(--muted)]">Ingresos por fuente</h3>
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--chip)] px-4 py-3 text-sm">
              <span>CLOUVA VIP</span><span className="font-semibold">{loadingStats ? "…" : money(stats.ingresosVip)}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--chip)] px-4 py-3 text-sm">
              <span>Servicios de Estudio</span><span className="font-semibold">{loadingStats ? "…" : money(stats.ingresosServicios)}</span>
            </div>
          </div>
          <p className="mt-3 text-xs text-[var(--muted)]">Suma directa de pagos confirmados por Mercado Pago (webhook verificado). No incluye Marketplace ni productos/servicios todavía, porque esos módulos no cobran dinero real hoy.</p>
        </PremiumCard>
        <ActivityFeed items={loadingStats ? ["Cargando actividad..."] : activity} />
      </div>

      <PremiumCard className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm uppercase tracking-[0.16em] text-[var(--muted)]">Usuarios</h3>
            <p className="mt-1 text-sm text-white/60">Ver, marcar VIP a mano y bloquear cuentas.</p>
          </div>
          <Link href="/admin/clientes" className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black">Ir a Clientes</Link>
        </div>
      </PremiumCard>
    </div>
  );
}
