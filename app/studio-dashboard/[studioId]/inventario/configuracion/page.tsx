"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Barcode, Camera, Check, Loader2, PackageOpen, Pencil, Plus, Save, Settings2, ShoppingCart, Trash2, X } from "lucide-react";
import { MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Category = { id: string; name: string; slug: string; description: string | null; display_order: number; active: boolean };
type Item = {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  image_url: string | null;
  quantity: number;
  unit: string;
  minimum_quantity: number;
  ideal_quantity: number | null;
  unit_cost: number | null;
  replacement_cost: number | null;
  supplier: string | null;
  physical_location: string | null;
  last_purchase_at: string | null;
  notes: string | null;
  barcode_value: string | null;
  stock_source: "managed" | "commerce_product" | "commerce_variant";
  active: boolean;
  state: "OK" | "BAJO" | "FALTA";
};
type Movement = { id: string; item_id: string; delta: number; unit: string; movement_type: string; reason: string | null; created_at: string; player: { display_name: string | null; username: string | null } | null };
type Purchase = { id: string; item_id: string | null; name: string; quantity_needed: number; unit: string; priority: string; estimated_price: number | null; actual_price: number | null; receipt_url: string | null; supplier: string | null; status: string; created_at: string };
type Payload = { space: { id: string; name: string; slug: string }; role: string; categories: Category[]; items: Item[]; purchases: Purchase[]; movements: Movement[] };

type ItemDraft = {
  name: string; description: string; categoryId: string; unit: string; minimumQuantity: string; idealQuantity: string;
  unitCost: string; replacementCost: string; supplier: string; physicalLocation: string; notes: string; barcodeValue: string; imageUrl: string; active: boolean;
};

const CARD = "rounded-[22px] border border-white/[0.08] bg-[#0b0912]";
const INPUT = "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-400/60";
const UNITS = ["unidad", "g", "kg", "ml", "litros", "packs", "cajas", "resmas", "rollos", "botellas", "latas"];

function asText(value: number | null) { return value == null ? "" : String(value); }
function playerName(player: Movement["player"]) { return player?.display_name || (player?.username ? `@${player.username}` : "Player"); }
function when(value: string) { return new Date(value).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }

function toDraft(item: Item): ItemDraft {
  return {
    name: item.name,
    description: item.description ?? "",
    categoryId: item.category_id ?? "",
    unit: item.unit,
    minimumQuantity: String(item.minimum_quantity ?? 0),
    idealQuantity: asText(item.ideal_quantity),
    unitCost: asText(item.unit_cost),
    replacementCost: asText(item.replacement_cost),
    supplier: item.supplier ?? "",
    physicalLocation: item.physical_location ?? "",
    notes: item.notes ?? "",
    barcodeValue: item.barcode_value ?? "",
    imageUrl: item.image_url ?? "",
    active: item.active,
  };
}

export default function InventorySettingsPage() {
  const params = useParams<{ studioId: string }>();
  const studioId = String(params.studioId || "");
  const { user, loading: authLoading } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [search, setSearch] = useState("");
  const [purchaseDrafts, setPurchaseDrafts] = useState<Record<string, { actualPrice: string; receiptUrl: string }>>({});

  const load = useCallback(async () => {
    if (!user || !studioId) return;
    setLoading(true); setError(null);
    try {
      const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/inventory`);
      const payload = await readApiJson<Payload>(response);
      setData(payload);
      setPurchaseDrafts(Object.fromEntries(payload.purchases.map((purchase) => [purchase.id, { actualPrice: asText(purchase.actual_price), receiptUrl: purchase.receipt_url ?? "" }])));
      setSelectedId((current) => current && payload.items.some((item) => item.id === current) ? current : payload.items[0]?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo abrir la configuración del inventario.");
    } finally { setLoading(false); }
  }, [studioId, user]);

  useEffect(() => { if (!authLoading && user) void load(); }, [authLoading, load, user]);

  const selected = useMemo(() => data?.items.find((item) => item.id === selectedId) ?? null, [data?.items, selectedId]);
  useEffect(() => { setDraft(selected ? toDraft(selected) : null); }, [selected]);

  const visibleItems = useMemo(() => (data?.items ?? []).filter((item) => !search.trim() || `${item.name} ${item.description ?? ""} ${item.barcode_value ?? ""}`.toLowerCase().includes(search.toLowerCase())), [data?.items, search]);
  const selectedCategory = data?.categories.find((category) => category.id === draft?.categoryId) ?? null;
  const selectedMovements = (data?.movements ?? []).filter((movement) => movement.item_id === selectedId).slice(0, 25);
  const canInventory = Boolean(data && ["owner", "admin", "manager", "inventory"].includes(data.role));

  async function settingsAction(body: Record<string, unknown>) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/inventory/settings`, { method: "POST", body: JSON.stringify(body) });
      const result = await readApiJson<Record<string, unknown>>(response);
      await load();
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar.");
      return null;
    } finally { setBusy(false); }
  }

  async function saveItem() {
    if (!selected || !draft || !draft.name.trim()) return;
    const result = await settingsAction({ action: "update_item", itemId: selected.id, ...draft });
    if (result) setMessage("Ítem actualizado.");
  }

  async function createCategory() {
    if (!categoryName.trim()) return;
    const result = await settingsAction({ action: "create_category", name: categoryName });
    if (result) { setCategoryName(""); setMessage("Categoría creada."); }
  }

  async function renameCategory(category: Category) {
    const name = window.prompt("Nombre de la categoría", category.name)?.trim();
    if (!name || name === category.name) return;
    const result = await settingsAction({ action: "update_category", categoryId: category.id, name });
    if (result) setMessage("Categoría actualizada.");
  }

  async function archiveSelected() {
    if (!selected || !window.confirm(`¿Archivar ${selected.name}? El historial no se borra.`)) return;
    const result = await settingsAction({ action: "archive_item", itemId: selected.id });
    if (result) { setSelectedId(null); setMessage("Ítem archivado sin borrar su historial."); }
  }

  async function uploadImage(file: File) {
    if (!draft) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const form = new FormData(); form.append("file", file);
      const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/inventory/image`, { method: "POST", body: form });
      const payload = await readApiJson<{ url: string }>(response);
      setDraft((current) => current ? { ...current, imageUrl: payload.url } : current);
      setMessage("Foto subida. Guardá el ítem para vincularla.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo subir la foto.");
    } finally { setBusy(false); }
  }

  async function updatePurchase(purchase: Purchase, status: "comprado" | "ingresado") {
    const values = purchaseDrafts[purchase.id] ?? { actualPrice: "", receiptUrl: "" };
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await authenticatedFetch(`/api/studios/${encodeURIComponent(studioId)}/inventory`, {
        method: "POST",
        body: JSON.stringify({ action: "update_purchase", purchaseId: purchase.id, status, actualPrice: values.actualPrice, receiptUrl: values.receiptUrl }),
      });
      await readApiJson(response); await load();
      setMessage(status === "comprado" ? "Compra registrada." : "Compra ingresada al inventario.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo actualizar la compra."); }
    finally { setBusy(false); }
  }

  if (loading && !data) return <main className="min-h-screen bg-[#05040a] text-white"><MainNav/><div className="grid min-h-[70vh] place-items-center"><Loader2 className="animate-spin text-violet-300"/></div></main>;

  return <main className="min-h-screen bg-[#05040a] pb-28 text-white"><MainNav/><div className="mx-auto max-w-7xl px-4 py-7 sm:px-7">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><Link href={`/studio-dashboard/${studioId}/inventario`} className="inline-flex items-center gap-2 text-xs text-white/40"><ArrowLeft size={14}/> Inventario</Link><p className="mt-5 text-[11px] uppercase tracking-[.18em] text-white/30">SPACE INVENTORY · CONFIGURACIÓN</p><h1 className="mt-1 text-3xl font-semibold sm:text-4xl">{data?.space.name ?? "Inventario"}</h1><p className="mt-2 text-sm text-white/42">Datos completos, categorías, compras y trazabilidad.</p></div><Settings2 className="text-violet-300"/></div>

    {error ? <div className="mt-5 flex items-start justify-between rounded-xl border border-rose-300/15 bg-rose-300/[.06] p-3 text-sm text-rose-200"><span>{error}</span><button onClick={() => setError(null)}><X size={15}/></button></div> : null}
    {message ? <p className="mt-5 rounded-xl border border-emerald-300/15 bg-emerald-300/[.06] p-3 text-sm text-emerald-200">{message}</p> : null}

    <section className="mt-6 grid gap-4 lg:grid-cols-[.7fr_1.3fr]">
      <div className="space-y-4">
        <div className={`${CARD} p-4`}><div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-[.16em] text-white/30">Categorías</p><h2 className="mt-1 font-semibold">Extensibles por Space</h2></div><Plus size={16} className="text-violet-300"/></div>{canInventory ? <div className="mt-4 flex gap-2"><input className={INPUT} placeholder="Nueva categoría" value={categoryName} onChange={(event) => setCategoryName(event.target.value)}/><button disabled={busy || !categoryName.trim()} onClick={() => void createCategory()} className="rounded-xl bg-violet-600 px-3 text-sm font-semibold disabled:opacity-40">Crear</button></div> : null}<div className="mt-3 flex flex-wrap gap-2">{data?.categories.map((category) => <button key={category.id} disabled={!canInventory} onClick={() => void renameCategory(category)} className="rounded-full border border-white/10 bg-white/[.03] px-3 py-1.5 text-xs text-white/60 disabled:cursor-default">{category.name}{canInventory ? <Pencil size={10} className="ml-1.5 inline opacity-50"/> : null}</button>)}</div></div>

        <div className={`${CARD} p-4`}><p className="text-[10px] uppercase tracking-[.16em] text-white/30">Ítems</p><input className={`${INPUT} mt-3`} placeholder="Buscar nombre o código" value={search} onChange={(event) => setSearch(event.target.value)}/><div className="mt-3 max-h-[52vh] space-y-1 overflow-y-auto pr-1">{visibleItems.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full rounded-xl border p-3 text-left ${selectedId === item.id ? "border-violet-300/30 bg-violet-300/[.08]" : "border-white/[.06] bg-black/20"}`}><div className="flex items-center justify-between gap-3"><div className="min-w-0"><strong className="block truncate text-sm">{item.name}</strong><small className="text-white/35">{item.stock_source === "managed" ? "Inventario" : "Commerce"} · {item.unit}</small></div><span className="text-xs tabular-nums text-white/60">{item.quantity}</span></div></button>)}{!visibleItems.length ? <p className="p-4 text-center text-xs text-white/30">No hay ítems.</p> : null}</div></div>
      </div>

      <div className="space-y-4">
        {selected && draft ? <div className={`${CARD} p-4 sm:p-6`}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[.16em] text-white/30">Ficha del ítem</p><h2 className="mt-1 text-xl font-semibold">{selected.name}</h2><p className="mt-1 text-xs text-white/35">Stock: {selected.quantity} {selected.unit} · {selected.state}{selected.stock_source !== "managed" ? " · cantidad administrada por Commerce" : ""}</p></div>{canInventory ? <div className="flex gap-2"><button disabled={busy} onClick={() => void archiveSelected()} className="rounded-xl border border-rose-300/15 px-3 py-2 text-xs text-rose-200"><Trash2 size={13} className="mr-1 inline"/>Archivar</button><button disabled={busy} onClick={() => void saveItem()} className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold"><Save size={13} className="mr-1 inline"/>Guardar</button></div> : null}</div>

          {selectedCategory?.slug === "jalea" ? <div className="mt-4 rounded-2xl border border-violet-300/15 bg-violet-300/[.06] p-4"><p className="text-[10px] uppercase tracking-[.2em] text-violet-200/60">Elevador Cuántico de Jalea</p><strong className="mt-1 block text-lg">{selected.quantity} {selected.unit}</strong><p className="mt-1 text-xs text-white/40">Para el frasco físico, usá gramos y registrá cada entrada/salida desde el panel rápido.</p></div> : null}

          <div className="mt-5 grid gap-3 sm:grid-cols-2"><Field label="Nombre" value={draft.name} onChange={(value) => setDraft((current) => current ? { ...current, name: value } : current)}/><label><Label>Categoría</Label><select className={INPUT} value={draft.categoryId} onChange={(event) => setDraft((current) => current ? { ...current, categoryId: event.target.value } : current)}><option value="">Sin categoría</option>{data?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="sm:col-span-2"><Label>Descripción</Label><textarea rows={3} className={INPUT} value={draft.description} onChange={(event) => setDraft((current) => current ? { ...current, description: event.target.value } : current)}/></label><label><Label>Unidad</Label><select className={INPUT} value={draft.unit} onChange={(event) => setDraft((current) => current ? { ...current, unit: event.target.value } : current)}>{UNITS.map((unit) => <option key={unit}>{unit}</option>)}</select></label><Field label="Stock mínimo" inputMode="decimal" value={draft.minimumQuantity} onChange={(value) => setDraft((current) => current ? { ...current, minimumQuantity: value } : current)}/><Field label="Cantidad ideal" inputMode="decimal" value={draft.idealQuantity} onChange={(value) => setDraft((current) => current ? { ...current, idealQuantity: value } : current)}/><Field label="Costo unitario" inputMode="decimal" value={draft.unitCost} onChange={(value) => setDraft((current) => current ? { ...current, unitCost: value } : current)}/><Field label="Costo de reposición" inputMode="decimal" value={draft.replacementCost} onChange={(value) => setDraft((current) => current ? { ...current, replacementCost: value } : current)}/><Field label="Proveedor" value={draft.supplier} onChange={(value) => setDraft((current) => current ? { ...current, supplier: value } : current)}/><Field label="Ubicación física" value={draft.physicalLocation} onChange={(value) => setDraft((current) => current ? { ...current, physicalLocation: value } : current)}/><div className="sm:col-span-2"><Label>QR / EAN / código</Label><div className="relative"><Barcode size={15} className="absolute left-3 top-3 text-white/30"/><input className={`${INPUT} pl-9`} value={draft.barcodeValue} onChange={(event) => setDraft((current) => current ? { ...current, barcodeValue: event.target.value } : current)} placeholder="Escaneado o ingreso manual"/></div></div><div className="sm:col-span-2"><Label>Foto</Label><div className="grid gap-2 sm:grid-cols-[1fr_auto]"><input className={INPUT} value={draft.imageUrl} onChange={(event) => setDraft((current) => current ? { ...current, imageUrl: event.target.value } : current)} placeholder="URL de imagen"/><label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/[.04] px-4 text-sm"><Camera size={14} className="mr-2"/>Subir<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadImage(file); event.currentTarget.value = ""; }}/></label></div>{draft.imageUrl ? <img src={draft.imageUrl} alt="" className="mt-2 h-28 w-28 rounded-xl border border-white/10 object-cover"/> : null}</div><label className="sm:col-span-2"><Label>Notas</Label><textarea rows={4} className={INPUT} value={draft.notes} onChange={(event) => setDraft((current) => current ? { ...current, notes: event.target.value } : current)}/></label></div>
        </div> : <div className={`${CARD} grid min-h-64 place-items-center p-6 text-center text-sm text-white/35`}><div><PackageOpen className="mx-auto mb-3"/><p>Seleccioná un ítem para editar todos sus datos.</p></div></div>}

        {selected ? <div className={`${CARD} p-4 sm:p-5`}><p className="text-[10px] uppercase tracking-[.16em] text-white/30">Historial</p><h2 className="mt-1 font-semibold">Movimientos de {selected.name}</h2><div className="mt-3 space-y-1">{selectedMovements.map((movement) => <div key={movement.id} className="grid grid-cols-[auto_1fr_auto] gap-3 border-b border-white/[.05] py-2 text-xs"><strong className={movement.delta > 0 ? "text-emerald-300" : "text-orange-300"}>{movement.delta > 0 ? "+" : ""}{movement.delta} {movement.unit}</strong><span className="text-white/55">{movement.movement_type} · {playerName(movement.player)}{movement.reason ? ` · ${movement.reason}` : ""}</span><span className="text-white/28">{when(movement.created_at)}</span></div>)}{!selectedMovements.length ? <p className="py-4 text-xs text-white/30">Sin movimientos todavía.</p> : null}</div></div> : null}
      </div>
    </section>

    <section className={`${CARD} mt-4 p-4 sm:p-6`}><div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-[.16em] text-white/30">Compras</p><h2 className="mt-1 text-lg font-semibold">Pendientes y comprobantes</h2></div><ShoppingCart size={18} className="text-violet-300"/></div><div className="mt-4 grid gap-3 lg:grid-cols-2">{data?.purchases.filter((purchase) => purchase.status !== "ingresado").map((purchase) => { const values = purchaseDrafts[purchase.id] ?? { actualPrice: "", receiptUrl: "" }; return <article key={purchase.id} className="rounded-2xl border border-white/[.07] bg-black/20 p-4"><div className="flex justify-between gap-3"><div><strong className="text-sm">{purchase.name}</strong><p className="mt-1 text-xs text-white/38">{purchase.quantity_needed} {purchase.unit} · {purchase.priority} · {purchase.status}</p></div><span className="text-xs text-white/40">{purchase.supplier || "Sin proveedor"}</span></div>{canInventory ? <div className="mt-3 grid gap-2 sm:grid-cols-2"><input className={INPUT} inputMode="decimal" placeholder="Precio real" value={values.actualPrice} onChange={(event) => setPurchaseDrafts((current) => ({ ...current, [purchase.id]: { ...values, actualPrice: event.target.value } }))}/><input className={INPUT} placeholder="URL comprobante" value={values.receiptUrl} onChange={(event) => setPurchaseDrafts((current) => ({ ...current, [purchase.id]: { ...values, receiptUrl: event.target.value } }))}/><div className="flex gap-2 sm:col-span-2">{purchase.status === "pendiente" ? <button disabled={busy} onClick={() => void updatePurchase(purchase, "comprado")} className="rounded-xl border border-violet-300/15 bg-violet-300/[.06] px-3 py-2 text-xs text-violet-200"><Check size={13} className="mr-1 inline"/>Comprado</button> : null}{purchase.status === "comprado" && purchase.item_id ? <button disabled={busy} onClick={() => void updatePurchase(purchase, "ingresado")} className="rounded-xl bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200">Ingresar stock</button> : null}</div></div> : null}</article>; })}{!data?.purchases.filter((purchase) => purchase.status !== "ingresado").length ? <p className="text-sm text-white/35">No hay compras pendientes.</p> : null}</div></section>
  </div></main>;
}

function Label({ children }: { children: React.ReactNode }) { return <span className="mb-1.5 block text-[10px] uppercase tracking-[.14em] text-white/32">{children}</span>; }
function Field({ label, value, onChange, inputMode }: { label: string; value: string; onChange: (value: string) => void; inputMode?: "decimal" }) { return <label><Label>{label}</Label><input className={INPUT} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)}/></label>; }
