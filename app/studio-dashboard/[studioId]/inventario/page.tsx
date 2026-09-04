"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, Boxes, Check, CircleDollarSign, ClipboardList, Loader2, PackagePlus, Search, ShoppingCart, Store, Users, X } from "lucide-react";
import { MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Player = { id: string; display_name: string | null; username: string | null; profile_image_url: string | null };
type Category = { id: string; name: string; slug: string };
type Item = {
  id: string; name: string; description: string | null; category_id: string | null; quantity: number; unit: string;
  minimum_quantity: number; ideal_quantity: number | null; unit_cost: number | null; replacement_cost: number | null;
  supplier: string | null; physical_location: string | null; notes: string | null; image_url: string | null;
  stock_source: "managed" | "commerce_product" | "commerce_variant"; state: "OK" | "BAJO" | "FALTA";
};
type Purchase = { id: string; item_id: string | null; name: string; quantity_needed: number; unit: string; priority: string; estimated_price: number | null; actual_price: number | null; supplier: string | null; status: string; source: string; added_by: Player | null; created_at: string };
type Movement = { id: string; item_id: string; delta: number; unit: string; movement_type: string; reason: string | null; player: Player | null; created_at: string };
type BoardEntry = { id: string; name: string; description: string | null; category: string | null; price: number | null; currency: string; availability: string; active: boolean; item_id: string | null; is_free: boolean };
type Member = { player_id: string; role: string; player: Player | null };
type Payload = {
  space: { id: string; name: string; slug: string; accent_color: string | null };
  role: string; categories: Category[]; items: Item[]; purchases: Purchase[]; movements: Movement[]; board: BoardEntry[]; members: Member[];
  summary: { totalItems: number; lowStock: number; pendingPurchases: number; estimatedValue: number; expenses: number; operationalSales: number };
};

const CARD = "rounded-[22px] border border-white/[0.08] bg-[#0b0912]";
const INPUT = "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/60";
const UNITS = ["unidad", "g", "kg", "ml", "litros", "packs", "cajas", "resmas", "rollos", "botellas", "latas"];

function money(value: number) { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value || 0); }
function when(value: string) { return new Date(value).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
function playerName(player: Player | null) { return player?.display_name || (player?.username ? `@${player.username}` : "Player"); }
function roleLabel(role: string) { if (["owner", "admin"].includes(role)) return "Admin"; if (role === "manager") return "Encargado"; if (role === "viewer") return "Solo lectura"; return "Player"; }

export default function StudioInventoryPage() {
  const params = useParams<{ studioId: string }>();
  const studioId = String(params.studioId || "");
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [showNewItem, setShowNewItem] = useState(false);
  const [showPurchase, setShowPurchase] = useState(false);
  const [newItem, setNewItem] = useState({ name: "", categoryId: "", quantity: "0", unit: "unidad", minimumQuantity: "0", idealQuantity: "", unitCost: "", replacementCost: "", supplier: "", physicalLocation: "", notes: "" });
  const [newPurchase, setNewPurchase] = useState({ itemId: "", name: "", quantityNeeded: "1", unit: "unidad", priority: "normal", estimatedPrice: "", supplier: "" });
  const [quick, setQuick] = useState<{ item: Item; direction: "in" | "out" } | null>(null);
  const [quickQty, setQuickQty] = useState("1");
  const [quickType, setQuickType] = useState("CONSUMO");

  const load = useCallback(async () => {
    if (!user || !studioId) return;
    setLoading(true); setError(null);
    try {
      const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/inventory`);
      setData(await readApiJson<Payload>(response));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo abrir el inventario."); }
    finally { setLoading(false); }
  }, [studioId, user]);

  useEffect(() => { if (!authLoading && user) void load(); }, [authLoading, load, user]);

  const canInventory = Boolean(data && ["owner", "admin", "manager", "inventory"].includes(data.role));
  const canSales = Boolean(data && ["owner", "admin", "manager", "sales"].includes(data.role));
  const visibleItems = useMemo(() => (data?.items ?? []).filter((item) => {
    const categoryMatch = category === "all" || item.category_id === category;
    const textMatch = !search.trim() || `${item.name} ${item.description ?? ""} ${item.physical_location ?? ""}`.toLowerCase().includes(search.toLowerCase());
    return categoryMatch && textMatch;
  }), [category, data?.items, search]);

  async function action(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/inventory`, { method: "POST", body: JSON.stringify(body) });
      await readApiJson(response); await load(); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo completar la operación."); return false; }
    finally { setBusy(false); }
  }

  async function createItem() {
    if (!newItem.name.trim()) return;
    if (await action({ action: "create_item", ...newItem })) {
      setNewItem({ name: "", categoryId: "", quantity: "0", unit: "unidad", minimumQuantity: "0", idealQuantity: "", unitCost: "", replacementCost: "", supplier: "", physicalLocation: "", notes: "" });
      setShowNewItem(false);
    }
  }

  async function createPurchase() {
    if (!newPurchase.name.trim()) return;
    if (await action({ action: "create_purchase", ...newPurchase })) {
      setNewPurchase({ itemId: "", name: "", quantityNeeded: "1", unit: "unidad", priority: "normal", estimatedPrice: "", supplier: "" });
      setShowPurchase(false);
    }
  }

  async function submitQuick() {
    if (!quick) return;
    const type = quick.direction === "in" ? "INGRESO" : quickType;
    if (await action({ action: "movement", itemId: quick.item.id, direction: quick.direction, quantity: quickQty, movementType: type })) {
      setQuick(null); setQuickQty("1"); setQuickType("CONSUMO");
    }
  }

  if (loading && !data) return <main className="min-h-screen bg-[#05040a] text-white"><MainNav /><div className="grid min-h-[70vh] place-items-center"><Loader2 className="animate-spin text-violet-300" /></div></main>;

  const accent = data?.space.accent_color && /^#[0-9a-f]{3,8}$/i.test(data.space.accent_color) ? data.space.accent_color : "#8f5cff";

  return <main className="min-h-screen bg-[#05040a] pb-24 text-white">
    <MainNav />
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-7 sm:py-9">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><Link href={`/studio-dashboard/${studioId}`} className="inline-flex items-center gap-2 text-xs text-white/45 hover:text-white"><ArrowLeft size={14}/> Volver al Studio</Link><p className="mt-5 text-[11px] uppercase tracking-[.18em] text-white/35">223 OPERATIONS · SPACE INVENTORY</p><h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-5xl">{data?.space.name ?? "Inventario"}</h1><p className="mt-2 text-sm text-white/45">Inventario colaborativo · {roleLabel(data?.role ?? "viewer")}</p></div>
        <div className="flex gap-2">{canInventory ? <button onClick={() => setShowPurchase(true)} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm"><ShoppingCart size={15} className="mr-2 inline"/>Comprar</button> : null}{canInventory ? <button onClick={() => setShowNewItem(true)} className="rounded-xl px-3 py-2 text-sm font-semibold" style={{ backgroundColor: accent }}><PackagePlus size={15} className="mr-2 inline"/>Nuevo ítem</button> : null}</div>
      </div>

      {error ? <div className="mt-5 flex items-start justify-between rounded-2xl border border-rose-300/15 bg-rose-300/[.06] p-4 text-sm text-rose-200"><span>{error}</span><button onClick={() => setError(null)}><X size={16}/></button></div> : null}

      {data ? <>
        <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="TOTAL ITEMS" value={String(data.summary.totalItems)} icon={<Boxes size={17}/>} />
          <Metric label="STOCK BAJO" value={String(data.summary.lowStock)} icon={<ArrowDown size={17}/>} danger={data.summary.lowStock > 0} />
          <Metric label="POR COMPRAR" value={String(data.summary.pendingPurchases)} icon={<ClipboardList size={17}/>} />
          <Metric label="VALOR ESTIMADO" value={money(data.summary.estimatedValue)} icon={<CircleDollarSign size={17}/>} compact />
        </section>

        <section className="mt-5 grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
          <div className={`${CARD} p-4 sm:p-5`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs uppercase tracking-[.16em] text-white/32">Inventario</p><h2 className="mt-1 text-xl font-semibold">Todo lo que tenemos</h2></div><div className="flex gap-2"><label className="relative flex-1"><Search size={14} className="absolute left-3 top-3 text-white/30"/><input className={`${INPUT} pl-9`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar…"/></label><select className={INPUT} value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">Todas</option>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div></div>
            <div className="mt-4 grid gap-2">{visibleItems.length ? visibleItems.map((item) => <article key={item.id} className="rounded-2xl border border-white/[.07] bg-black/20 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="truncate text-sm">{item.name}</strong><Status state={item.state}/>{item.stock_source !== "managed" ? <span className="rounded-full bg-cyan-300/[.08] px-2 py-1 text-[10px] text-cyan-200">Commerce</span> : null}</div><p className="mt-1 text-xs text-white/38">{item.physical_location || "Sin ubicación"}{item.supplier ? ` · ${item.supplier}` : ""}</p></div><div className="text-right"><strong className="block text-xl tabular-nums">{Number(item.quantity).toLocaleString("es-AR", { maximumFractionDigits: 4 })} <span className="text-sm text-white/45">{item.unit}</span></strong><small className="text-white/32">mín. {Number(item.minimum_quantity).toLocaleString("es-AR")} {item.unit}</small></div></div>{canInventory && item.stock_source === "managed" ? <div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => { setQuick({ item, direction: "in" }); setQuickType("INGRESO"); }} className="rounded-xl border border-emerald-300/15 bg-emerald-300/[.06] py-2 text-xs font-semibold text-emerald-200"><ArrowUp size={14} className="mr-1 inline"/> Entrada</button><button onClick={() => { setQuick({ item, direction: "out" }); setQuickType("CONSUMO"); }} className="rounded-xl border border-orange-300/15 bg-orange-300/[.06] py-2 text-xs font-semibold text-orange-200"><ArrowDown size={14} className="mr-1 inline"/> Salida</button></div> : null}</article>) : <Empty text="Todavía no hay ítems con este filtro."/>}</div>
          </div>

          <div className="space-y-4">
            <section className={`${CARD} p-4 sm:p-5`}><p className="text-xs uppercase tracking-[.16em] text-white/32">Compras pendientes</p><h2 className="mt-1 text-lg font-semibold">Lo que falta</h2><div className="mt-4 space-y-2">{data.purchases.filter((p) => p.status !== "ingresado").slice(0, 8).map((p) => <div key={p.id} className="rounded-xl border border-white/[.07] bg-black/20 p-3"><div className="flex justify-between gap-2"><div><strong className="text-sm">{p.name}</strong><p className="mt-1 text-xs text-white/38">{p.quantity_needed} {p.unit} · {p.priority}</p></div><span className="text-[10px] uppercase text-amber-200/80">{p.status}</span></div>{canInventory ? <div className="mt-2 flex gap-2">{p.status === "pendiente" ? <button disabled={busy} onClick={() => void action({ action: "update_purchase", purchaseId: p.id, status: "comprado" })} className="text-xs text-violet-300">Marcar comprado</button> : null}{p.status === "comprado" && p.item_id ? <button disabled={busy} onClick={() => void action({ action: "update_purchase", purchaseId: p.id, status: "ingresado" })} className="text-xs font-semibold text-emerald-300">Ingresar al inventario</button> : null}</div> : null}</div>)}{!data.purchases.filter((p) => p.status !== "ingresado").length ? <Empty text="Nada pendiente."/> : null}</div></section>
            <section className={`${CARD} p-4 sm:p-5`}><p className="text-xs uppercase tracking-[.16em] text-white/32">Miembros 223</p><h2 className="mt-1 text-lg font-semibold">Players</h2><div className="mt-4 space-y-2">{data.members.map((m) => <div key={m.player_id} className="flex items-center justify-between rounded-xl bg-white/[.025] px-3 py-2"><span className="text-sm">{playerName(m.player)}</span><span className="text-[10px] uppercase tracking-wide text-white/35">{roleLabel(m.role)}</span></div>)}</div></section>
          </div>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className={`${CARD} p-4 sm:p-5`}><p className="text-xs uppercase tracking-[.16em] text-white/32">Movimientos</p><h2 className="mt-1 text-lg font-semibold">Entró / salió</h2><div className="mt-4 space-y-1">{data.movements.slice(0, 12).map((m) => <div key={m.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-white/[.05] py-2.5"><span className={`font-semibold tabular-nums ${Number(m.delta) > 0 ? "text-emerald-300" : "text-orange-300"}`}>{Number(m.delta) > 0 ? "+" : ""}{Number(m.delta).toLocaleString("es-AR")} {m.unit}</span><span className="min-w-0"><span className="block truncate text-xs text-white/65">{data.items.find((i) => i.id === m.item_id)?.name || m.movement_type}</span><small className="text-white/30">{playerName(m.player)} · {m.movement_type}</small></span><small className="text-right text-white/30">{when(m.created_at)}</small></div>)}{!data.movements.length ? <Empty text="Todavía no hay movimientos."/> : null}</div></div>
          <div className={`${CARD} p-4 sm:p-5`}><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[.16em] text-white/32">Pizarrón 223</p><h2 className="mt-1 text-lg font-semibold">Lo que ofrecemos</h2></div><Store size={19} className="text-violet-300"/></div><div className="mt-4 grid gap-2 sm:grid-cols-2">{data.board.filter((b) => b.active).map((b) => <article key={b.id} className="rounded-2xl border border-white/[.07] bg-black/20 p-4"><div className="flex justify-between gap-3"><div><strong className="text-sm uppercase">{b.name}</strong><p className="mt-1 text-xs text-white/35">{b.description}</p></div><strong className="whitespace-nowrap text-sm">{b.is_free ? "GRATIS" : b.price == null ? "$ —" : money(b.price)}</strong></div>{canSales && b.item_id ? <button disabled={busy} onClick={() => void action({ action: "register_board_sale", boardId: b.id, quantity: 1 })} className="mt-3 w-full rounded-xl border border-violet-300/15 bg-violet-300/[.07] py-2 text-xs font-semibold text-violet-200">Registrar venta · 1</button> : null}</article>)}</div><div className="mt-4 grid grid-cols-2 gap-2 text-xs text-white/40"><div className="rounded-xl bg-white/[.025] p-3"><span className="block">Gastos registrados</span><strong className="mt-1 block text-sm text-white/75">{money(data.summary.expenses)}</strong></div><div className="rounded-xl bg-white/[.025] p-3"><span className="block">Ventas stock</span><strong className="mt-1 block text-sm text-white/75">{money(data.summary.operationalSales)}</strong></div></div></div>
        </section>
      </> : null}
    </div>

    {quick ? <Modal title={`${quick.direction === "in" ? "+ Entrada" : "− Salida"} · ${quick.item.name}`} close={() => setQuick(null)}><div className="grid gap-3"><input autoFocus className={INPUT} inputMode="decimal" value={quickQty} onChange={(e) => setQuickQty(e.target.value)} placeholder={`Cantidad en ${quick.item.unit}`}/>{quick.direction === "out" ? <select className={INPUT} value={quickType} onChange={(e) => setQuickType(e.target.value)}><option value="CONSUMO">Consumo</option><option value="VENTA">Venta</option><option value="REGALO">Regalo</option><option value="ROTURA">Rotura</option><option value="PERDIDA">Pérdida</option><option value="AJUSTE">Ajuste</option></select> : null}<button disabled={busy} onClick={() => void submitQuick()} className="rounded-xl bg-violet-600 py-3 text-sm font-semibold disabled:opacity-50">{busy ? "Guardando…" : "Registrar"}</button></div></Modal> : null}

    {showNewItem ? <Modal title="Nuevo ítem" close={() => setShowNewItem(false)}><div className="grid gap-2 sm:grid-cols-2"><input className={`${INPUT} sm:col-span-2`} placeholder="Nombre" value={newItem.name} onChange={(e) => setNewItem((v) => ({ ...v, name: e.target.value }))}/><select className={INPUT} value={newItem.categoryId} onChange={(e) => setNewItem((v) => ({ ...v, categoryId: e.target.value }))}><option value="">Categoría</option>{data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><select className={INPUT} value={newItem.unit} onChange={(e) => setNewItem((v) => ({ ...v, unit: e.target.value }))}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select><input className={INPUT} inputMode="decimal" placeholder="Cantidad actual" value={newItem.quantity} onChange={(e) => setNewItem((v) => ({ ...v, quantity: e.target.value }))}/><input className={INPUT} inputMode="decimal" placeholder="Stock mínimo" value={newItem.minimumQuantity} onChange={(e) => setNewItem((v) => ({ ...v, minimumQuantity: e.target.value }))}/><input className={INPUT} inputMode="decimal" placeholder="Cantidad ideal" value={newItem.idealQuantity} onChange={(e) => setNewItem((v) => ({ ...v, idealQuantity: e.target.value }))}/><input className={INPUT} inputMode="decimal" placeholder="Costo unitario" value={newItem.unitCost} onChange={(e) => setNewItem((v) => ({ ...v, unitCost: e.target.value }))}/><input className={INPUT} placeholder="Proveedor" value={newItem.supplier} onChange={(e) => setNewItem((v) => ({ ...v, supplier: e.target.value }))}/><input className={INPUT} placeholder="Ubicación física" value={newItem.physicalLocation} onChange={(e) => setNewItem((v) => ({ ...v, physicalLocation: e.target.value }))}/><textarea className={`${INPUT} sm:col-span-2`} placeholder="Notas" value={newItem.notes} onChange={(e) => setNewItem((v) => ({ ...v, notes: e.target.value }))}/><button disabled={busy} onClick={() => void createItem()} className="rounded-xl bg-violet-600 py-3 text-sm font-semibold sm:col-span-2">Crear ítem</button></div></Modal> : null}

    {showPurchase ? <Modal title="Agregar compra pendiente" close={() => setShowPurchase(false)}><div className="grid gap-2"><select className={INPUT} value={newPurchase.itemId} onChange={(e) => { const item = data?.items.find((i) => i.id === e.target.value); setNewPurchase((v) => ({ ...v, itemId: e.target.value, name: item?.name ?? v.name, unit: item?.unit ?? v.unit })); }}><option value="">Sin ítem asociado</option>{data?.items.filter((i) => i.stock_source === "managed").map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select><input className={INPUT} placeholder="Qué hay que comprar" value={newPurchase.name} onChange={(e) => setNewPurchase((v) => ({ ...v, name: e.target.value }))}/><div className="grid grid-cols-2 gap-2"><input className={INPUT} inputMode="decimal" placeholder="Cantidad" value={newPurchase.quantityNeeded} onChange={(e) => setNewPurchase((v) => ({ ...v, quantityNeeded: e.target.value }))}/><select className={INPUT} value={newPurchase.priority} onChange={(e) => setNewPurchase((v) => ({ ...v, priority: e.target.value }))}><option value="baja">Baja</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></div><input className={INPUT} inputMode="decimal" placeholder="Precio estimado" value={newPurchase.estimatedPrice} onChange={(e) => setNewPurchase((v) => ({ ...v, estimatedPrice: e.target.value }))}/><input className={INPUT} placeholder="Proveedor" value={newPurchase.supplier} onChange={(e) => setNewPurchase((v) => ({ ...v, supplier: e.target.value }))}/><button disabled={busy} onClick={() => void createPurchase()} className="rounded-xl bg-violet-600 py-3 text-sm font-semibold">Agregar a compras</button></div></Modal> : null}
  </main>;
}

function Metric({ label, value, icon, danger, compact }: { label: string; value: string; icon: React.ReactNode; danger?: boolean; compact?: boolean }) { return <div className={`${CARD} p-4`}><div className="flex items-center justify-between text-white/35"><span className="text-[10px] tracking-[.14em]">{label}</span>{icon}</div><strong className={`mt-3 block ${compact ? "text-xl sm:text-2xl" : "text-3xl"} ${danger ? "text-amber-200" : "text-white"}`}>{value}</strong></div>; }
function Status({ state }: { state: Item["state"] }) { const cls = state === "OK" ? "bg-emerald-300/[.08] text-emerald-200" : state === "BAJO" ? "bg-amber-300/[.08] text-amber-200" : "bg-rose-300/[.08] text-rose-200"; return <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${cls}`}>{state}</span>; }
function Empty({ text }: { text: string }) { return <p className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-white/30">{text}</p>; }
function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-[100] flex items-end bg-black/70 p-3 backdrop-blur-sm sm:items-center sm:justify-center"><div className="w-full max-w-lg rounded-[24px] border border-white/10 bg-[#0c0912] p-4 shadow-2xl sm:p-5"><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">{title}</h3><button onClick={close} className="grid h-9 w-9 place-items-center rounded-full bg-white/[.05]"><X size={16}/></button></div>{children}</div></div>; }
