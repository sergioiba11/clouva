"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Check, Loader2, Pencil, Plus, ShoppingCart, X } from "lucide-react";
import { MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Item = { id: string; name: string; quantity: number; unit: string; stock_source: string };
type Entry = { id: string; name: string; description: string | null; category: string | null; price: number | null; currency: string; availability: string; active: boolean; item_id: string | null; is_free: boolean };
type Payload = { space: { name: string }; role: string; board: Entry[]; items: Item[] };

const INPUT = "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/60";
const EMPTY = { name: "", description: "", category: "", price: "", availability: "disponible", itemId: "", isFree: false, active: true };
function money(value: number | null) { return value == null ? "$ —" : new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value); }

export default function PizarronPage() {
  const params = useParams<{ studioId: string }>();
  const studioId = String(params.studioId || "");
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(EMPTY);
  const [sale, setSale] = useState<Entry | null>(null);
  const [saleQty, setSaleQty] = useState("1");

  const load = useCallback(async () => {
    if (!user || !studioId) return;
    setLoading(true); setError(null);
    try { const r = await authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/inventory`); setData(await readApiJson<Payload>(r)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cargar el Pizarrón."); }
    finally { setLoading(false); }
  }, [studioId, user]);
  useEffect(() => { if (!authLoading && user) void load(); }, [authLoading, load, user]);

  const canSales = Boolean(data && ["owner", "admin", "manager", "sales"].includes(data.role));

  function beginEdit(entry: Entry) {
    setEditing(entry); setShowForm(true);
    setDraft({ name: entry.name, description: entry.description ?? "", category: entry.category ?? "", price: entry.price == null ? "" : String(entry.price), availability: entry.availability, itemId: entry.item_id ?? "", isFree: entry.is_free, active: entry.active });
  }
  function beginNew() { setEditing(null); setDraft(EMPTY); setShowForm(true); }

  async function save() {
    if (!draft.name.trim()) return;
    setBusy(true); setError(null);
    try {
      const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/inventory`, {
        method: "POST",
        body: JSON.stringify({ action: editing ? "update_board_entry" : "create_board_entry", boardId: editing?.id, ...draft }),
      });
      await readApiJson(response); setShowForm(false); setEditing(null); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el Pizarrón."); }
    finally { setBusy(false); }
  }

  async function registerSale() {
    if (!sale) return;
    setBusy(true); setError(null);
    try {
      const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/inventory/board-sale`, { method: "POST", body: JSON.stringify({ boardId: sale.id, quantity: Number(saleQty) }) });
      await readApiJson(response); setSale(null); setSaleQty("1"); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo registrar la venta."); }
    finally { setBusy(false); }
  }

  return <main className="min-h-screen bg-[#05040a] pb-24 text-white"><MainNav/><div className="mx-auto max-w-5xl px-4 py-7 sm:px-7">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><Link href={`/studio-dashboard/${studioId}/inventario`} className="inline-flex items-center gap-2 text-xs text-white/40"><ArrowLeft size={14}/> Inventario</Link><p className="mt-5 text-[11px] uppercase tracking-[.18em] text-white/30">223 · PIZARRÓN</p><h1 className="mt-1 text-4xl font-semibold">{data?.space.name ?? "Pizarrón"}</h1><p className="mt-2 text-sm text-white/42">Productos y servicios que ofrecemos dentro del estudio.</p></div>{canSales ? <button onClick={beginNew} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold"><Plus size={15} className="mr-2 inline"/>Agregar</button> : null}</div>
    {error ? <p className="mt-5 rounded-xl border border-rose-300/15 bg-rose-300/[.06] p-3 text-sm text-rose-200">{error}</p> : null}
    {loading ? <div className="grid min-h-64 place-items-center"><Loader2 className="animate-spin"/></div> : <div className="mt-6 grid gap-3 sm:grid-cols-2">{data?.board.map((entry) => {
      const item = data.items.find((i) => i.id === entry.item_id);
      return <article key={entry.id} className={`rounded-[22px] border p-5 ${entry.active ? "border-white/[.08] bg-[#0b0912]" : "border-white/[.04] bg-white/[.015] opacity-55"}`}><div className="flex items-start justify-between gap-3"><div><span className="text-[10px] uppercase tracking-[.14em] text-white/30">{entry.category || "General"}</span><h2 className="mt-1 text-lg font-semibold uppercase">{entry.name}</h2><p className="mt-2 text-xs leading-5 text-white/38">{entry.description || "Sin descripción"}</p></div><strong className="whitespace-nowrap text-base">{entry.is_free ? "GRATIS" : money(entry.price)}</strong></div><div className="mt-4 flex flex-wrap gap-2 text-[10px]"><span className="rounded-full bg-white/[.05] px-2 py-1 text-white/45">{entry.availability}</span>{item ? <span className="rounded-full bg-cyan-300/[.07] px-2 py-1 text-cyan-200">Stock: {item.quantity} {item.unit}</span> : <span className="rounded-full bg-violet-300/[.07] px-2 py-1 text-violet-200">Servicio / sin stock</span>}</div>{canSales ? <div className="mt-4 grid grid-cols-2 gap-2"><button onClick={() => beginEdit(entry)} className="rounded-xl border border-white/10 py-2 text-xs"><Pencil size={13} className="mr-1 inline"/>Editar</button><button disabled={!entry.active || entry.availability !== "disponible"} onClick={() => setSale(entry)} className="rounded-xl border border-violet-300/15 bg-violet-300/[.06] py-2 text-xs font-semibold text-violet-200 disabled:opacity-30"><ShoppingCart size={13} className="mr-1 inline"/>Registrar</button></div> : null}</article>;
    })}</div>}
  </div>

  {showForm ? <Overlay close={() => setShowForm(false)} title={editing ? "Editar Pizarrón" : "Nueva entrada"}><div className="grid gap-2"><input className={INPUT} placeholder="Nombre" value={draft.name} onChange={(e) => setDraft((v) => ({ ...v, name: e.target.value }))}/><textarea className={INPUT} placeholder="Descripción" value={draft.description} onChange={(e) => setDraft((v) => ({ ...v, description: e.target.value }))}/><div className="grid grid-cols-2 gap-2"><input className={INPUT} placeholder="Categoría" value={draft.category} onChange={(e) => setDraft((v) => ({ ...v, category: e.target.value }))}/><input className={INPUT} inputMode="decimal" disabled={draft.isFree} placeholder="Precio" value={draft.price} onChange={(e) => setDraft((v) => ({ ...v, price: e.target.value }))}/></div><select className={INPUT} value={draft.itemId} onChange={(e) => setDraft((v) => ({ ...v, itemId: e.target.value }))}><option value="">Servicio / sin stock</option>{data?.items.map((i) => <option key={i.id} value={i.id}>{i.name} · {i.quantity} {i.unit}</option>)}</select><select className={INPUT} value={draft.availability} onChange={(e) => setDraft((v) => ({ ...v, availability: e.target.value }))}><option value="disponible">Disponible</option><option value="agotado">Agotado</option><option value="pausado">Pausado</option></select><label className="flex items-center gap-2 rounded-xl bg-white/[.025] p-3 text-sm"><input type="checkbox" checked={draft.isFree} onChange={(e) => setDraft((v) => ({ ...v, isFree: e.target.checked }))}/> Gratis</label><label className="flex items-center gap-2 rounded-xl bg-white/[.025] p-3 text-sm"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft((v) => ({ ...v, active: e.target.checked }))}/> Activo</label><button disabled={busy} onClick={() => void save()} className="rounded-xl bg-violet-600 py-3 text-sm font-semibold"><Check size={15} className="mr-2 inline"/>{busy ? "Guardando…" : "Guardar"}</button></div></Overlay> : null}

  {sale ? <Overlay close={() => setSale(null)} title={`Registrar · ${sale.name}`}><div className="grid gap-3"><div className="rounded-xl bg-white/[.025] p-4"><span className="text-xs text-white/40">Precio unitario</span><strong className="mt-1 block text-xl">{sale.is_free ? "GRATIS" : money(sale.price)}</strong></div><input autoFocus className={INPUT} inputMode="decimal" value={saleQty} onChange={(e) => setSaleQty(e.target.value)} placeholder="Cantidad"/><p className="text-xs leading-5 text-white/35">Esto registra el evento operativo y el Player. Si hay stock físico gestionado, se descuenta en la misma transacción. El dinero sigue perteneciendo a Mi Flow / Caja / Mercado Pago.</p><button disabled={busy} onClick={() => void registerSale()} className="rounded-xl bg-violet-600 py-3 text-sm font-semibold">{busy ? "Registrando…" : "Confirmar"}</button></div></Overlay> : null}
  </main>;
}

function Overlay({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) { return <div className="fixed inset-0 z-[100] flex items-end bg-black/75 p-3 backdrop-blur-sm sm:items-center sm:justify-center"><div className="w-full max-w-md rounded-[24px] border border-white/10 bg-[#0c0912] p-5"><div className="mb-4 flex items-center justify-between"><h3 className="font-semibold">{title}</h3><button onClick={close} className="grid h-9 w-9 place-items-center rounded-full bg-white/[.05]"><X size={15}/></button></div>{children}</div></div>; }
