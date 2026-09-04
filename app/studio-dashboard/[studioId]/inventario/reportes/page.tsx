"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, BarChart3, CircleDollarSign, Gift, Loader2, PackageOpen, ReceiptText, ShoppingCart, TrendingUp } from "lucide-react";
import { MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type SalesRow = { id: string; name: string; category: string | null; quantity: number; revenue: number; events: number };
type ConsumptionRow = { id: string; name: string; unit: string; consumed: number; gifts: number; losses: number; sales: number };
type DailyRow = { date: string; sales: number; expenses: number; events: number };
type EventRow = { id: string; event_type: string; quantity: number; total_amount: number; currency: string; created_at: string; note: string | null; board: { name: string } | null; player: { display_name: string | null; username: string | null } | null };
type PurchaseRow = { id: string; name: string; quantity_needed: number; unit: string; priority: string; estimated_price: number | null; actual_price: number | null; status: string };
type Payload = {
  space: { name: string; slug: string };
  role: string;
  summary: { operationalSales: number; expenses: number; operationalBalance: number; inventoryValue: number; giftsCount: number; giftsValue: number; saleEvents: number };
  salesByEntry: SalesRow[];
  consumptionByItem: ConsumptionRow[];
  daily: DailyRow[];
  recentEvents: EventRow[];
  pendingPurchases: PurchaseRow[];
};

const CARD = "rounded-[22px] border border-white/[0.08] bg-[#0b0912]";
function money(value: number) { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value || 0); }
function when(value: string) { return new Date(value).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
function playerName(player: EventRow["player"]) { return player?.display_name || (player?.username ? `@${player.username}` : "Player"); }

export default function InventoryReportsPage() {
  const params = useParams<{ studioId: string }>();
  const studioId = String(params.studioId || "");
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user || !studioId) return;
    setLoading(true); setError(null);
    try {
      const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/inventory/reports`);
      setData(await readApiJson<Payload>(response));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar los reportes.");
    } finally { setLoading(false); }
  }, [studioId, user]);

  useEffect(() => { if (!authLoading && user) void load(); }, [authLoading, load, user]);

  if (loading && !data) return <main className="min-h-screen bg-[#05040a] text-white"><MainNav/><div className="grid min-h-[70vh] place-items-center"><Loader2 className="animate-spin text-violet-300"/></div></main>;

  return <main className="min-h-screen bg-[#05040a] pb-28 text-white"><MainNav/><div className="mx-auto max-w-7xl px-4 py-7 sm:px-7">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><Link href={`/studio-dashboard/${studioId}/inventario`} className="inline-flex items-center gap-2 text-xs text-white/40"><ArrowLeft size={14}/> Inventario</Link><p className="mt-5 text-[11px] uppercase tracking-[.18em] text-white/30">SPACE INVENTORY · REPORTES</p><h1 className="mt-1 text-3xl font-semibold sm:text-4xl">{data?.space.name ?? "Reportes"}</h1><p className="mt-2 text-sm text-white/42">Operación real del Space: consumo, reposición, ventas y gastos.</p></div><BarChart3 className="text-violet-300"/></div>

    {error ? <p className="mt-5 rounded-xl border border-rose-300/15 bg-rose-300/[.06] p-3 text-sm text-rose-200">{error}</p> : null}

    {data ? <>
      <section className="mt-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="VENTAS OPERATIVAS" value={money(data.summary.operationalSales)} icon={<TrendingUp size={17}/>} />
        <Metric label="GASTOS REGISTRADOS" value={money(data.summary.expenses)} icon={<ReceiptText size={17}/>} />
        <Metric label="BALANCE OPERATIVO" value={money(data.summary.operationalBalance)} icon={<CircleDollarSign size={17}/>} emphasis />
        <Metric label="VALOR INVENTARIO" value={money(data.summary.inventoryValue)} icon={<PackageOpen size={17}/>} />
      </section>

      <p className="mt-3 text-xs leading-5 text-white/30">Estos números describen la operación del inventario y el Pizarrón. Los cobros y movimientos de dinero siguen perteneciendo a Mi Flow, Caja, Mercado Pago y al ledger financiero canónico.</p>

      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className={`${CARD} p-4 sm:p-5`}><div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-[.16em] text-white/30">Pizarrón</p><h2 className="mt-1 text-lg font-semibold">Ventas y servicios</h2></div><ShoppingCart size={18} className="text-violet-300"/></div><div className="mt-4 space-y-2">{data.salesByEntry.map((row) => <div key={row.id} className="rounded-xl border border-white/[.06] bg-black/20 p-3"><div className="flex items-start justify-between gap-3"><div><strong className="text-sm">{row.name}</strong><p className="mt-1 text-xs text-white/35">{row.category || "General"} · {row.quantity.toLocaleString("es-AR")} registrados · {row.events} movimientos</p></div><strong className="text-sm">{money(row.revenue)}</strong></div></div>)}{!data.salesByEntry.length ? <Empty text="Todavía no hay ventas o servicios registrados."/> : null}</div></div>

        <div className={`${CARD} p-4 sm:p-5`}><div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-[.16em] text-white/30">Inventario</p><h2 className="mt-1 text-lg font-semibold">Consumo y salidas</h2></div><PackageOpen size={18} className="text-violet-300"/></div><div className="mt-4 space-y-2">{data.consumptionByItem.map((row) => <div key={row.id} className="rounded-xl border border-white/[.06] bg-black/20 p-3"><strong className="text-sm">{row.name}</strong><div className="mt-2 grid grid-cols-4 gap-2 text-center text-[10px] text-white/35"><SmallStat label="Consumo" value={`${row.consumed} ${row.unit}`}/><SmallStat label="Regalo" value={`${row.gifts} ${row.unit}`}/><SmallStat label="Venta" value={`${row.sales} ${row.unit}`}/><SmallStat label="Pérdida" value={`${row.losses} ${row.unit}`}/></div></div>)}{!data.consumptionByItem.length ? <Empty text="Todavía no hay salidas registradas."/> : null}</div></div>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <div className={`${CARD} p-4 sm:p-5`}><p className="text-[10px] uppercase tracking-[.16em] text-white/30">Actividad</p><h2 className="mt-1 text-lg font-semibold">Ventas recientes</h2><div className="mt-4 space-y-1">{data.recentEvents.map((event) => <div key={event.id} className="grid grid-cols-[1fr_auto] gap-3 border-b border-white/[.05] py-2.5"><div><strong className="text-xs">{event.board?.name || "Pizarrón"}</strong><p className="mt-1 text-[11px] text-white/35">{event.event_type} · {event.quantity} · {playerName(event.player)}{event.note ? ` · ${event.note}` : ""}</p></div><div className="text-right"><strong className={event.event_type === "REGALO" ? "text-violet-200" : "text-emerald-200"}>{event.event_type === "REGALO" ? "GRATIS" : money(event.total_amount)}</strong><p className="mt-1 text-[10px] text-white/25">{when(event.created_at)}</p></div></div>)}{!data.recentEvents.length ? <Empty text="Sin actividad todavía."/> : null}</div></div>

        <div className="space-y-4"><div className={`${CARD} p-4 sm:p-5`}><div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-[.16em] text-white/30">Regalos</p><h2 className="mt-1 text-lg font-semibold">Entregas registradas</h2></div><Gift size={18} className="text-violet-300"/></div><strong className="mt-4 block text-3xl">{data.summary.giftsCount.toLocaleString("es-AR")}</strong><p className="mt-1 text-xs text-white/35">Eventos de Pizarrón marcados como GRATIS.</p></div>
        <div className={`${CARD} p-4 sm:p-5`}><p className="text-[10px] uppercase tracking-[.16em] text-white/30">Reposición</p><h2 className="mt-1 text-lg font-semibold">Por comprar</h2><div className="mt-3 space-y-2">{data.pendingPurchases.slice(0, 10).map((purchase) => <div key={purchase.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[.025] p-3"><div><strong className="text-xs">{purchase.name}</strong><p className="mt-1 text-[10px] text-white/35">{purchase.quantity_needed} {purchase.unit} · {purchase.priority}</p></div><span className="text-[10px] uppercase text-amber-200/80">{purchase.status}</span></div>)}{!data.pendingPurchases.length ? <Empty text="Nada pendiente."/> : null}</div></div></div>
      </section>

      <section className={`${CARD} mt-4 p-4 sm:p-5`}><p className="text-[10px] uppercase tracking-[.16em] text-white/30">Día por día</p><h2 className="mt-1 text-lg font-semibold">Pulso operativo</h2><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs"><thead className="text-white/30"><tr><th className="pb-2 font-normal">Fecha</th><th className="pb-2 font-normal">Ventas</th><th className="pb-2 font-normal">Gastos</th><th className="pb-2 font-normal">Balance</th><th className="pb-2 font-normal">Eventos</th></tr></thead><tbody>{data.daily.map((row) => <tr key={row.date} className="border-t border-white/[.05]"><td className="py-2.5">{new Date(`${row.date}T12:00:00`).toLocaleDateString("es-AR")}</td><td className="py-2.5 text-emerald-200">{money(row.sales)}</td><td className="py-2.5 text-orange-200">{money(row.expenses)}</td><td className="py-2.5">{money(row.sales - row.expenses)}</td><td className="py-2.5 text-white/45">{row.events}</td></tr>)}</tbody></table>{!data.daily.length ? <Empty text="Todavía no hay actividad diaria para mostrar."/> : null}</div></section>
    </> : null}
  </div></main>;
}

function Metric({ label, value, icon, emphasis }: { label: string; value: string; icon: React.ReactNode; emphasis?: boolean }) { return <div className={`${CARD} p-4 ${emphasis ? "ring-1 ring-violet-300/15" : ""}`}><div className="flex items-center justify-between text-white/35"><span className="text-[10px] tracking-[.14em]">{label}</span>{icon}</div><strong className="mt-3 block text-xl sm:text-2xl">{value}</strong></div>; }
function SmallStat({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-white/[.025] p-2"><span className="block">{label}</span><strong className="mt-1 block text-white/70">{value}</strong></div>; }
function Empty({ text }: { text: string }) { return <p className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-white/30">{text}</p>; }
