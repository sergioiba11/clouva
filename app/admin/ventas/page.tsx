"use client";

import { useEffect, useMemo, useState } from "react";

const orderStates = ["pendiente", "pagado", "preparando", "enviado", "cancelado"] as const;
type OrderState = (typeof orderStates)[number];

export default function VentasAdminPage() {
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [itemsByOrder, setItemsByOrder] = useState<Record<string, any[]>>({});
  const [form, setForm] = useState({ id: "", slug: "", name: "", description: "", price_cents: 0, stock: 0, category: "", active: true, status: "activo", image_url: "" });

  const load = async () => {
    setLoading(true);
    const { supabase } = await import("@/lib/supabase");
    const [{ data: p }, { data: o }, { data: oi }] = await Promise.all([
      supabase.from("products").select("id,slug,name,description,price_cents,category,active,status,product_variants(stock),product_images(image_url)").order("name"),
      supabase.from("orders").select("id,total_cents,payment_status,shipping_status,customer_id,created_at,customers(email)").order("created_at", { ascending: false }),
      supabase.from("order_items").select("order_id,qty,unit_price_cents,products(name)")
    ]);
    const grouped: Record<string, any[]> = {};
    (oi ?? []).forEach((it: any) => { grouped[it.order_id] = [...(grouped[it.order_id] ?? []), it]; });
    setProducts(p ?? []);
    setOrders(o ?? []);
    setItemsByOrder(grouped);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const metrics = useMemo(() => {
    const total = orders.reduce((a, o) => a + (o.total_cents ?? 0), 0);
    const today = new Date().toISOString().slice(0, 10);
    const salesToday = orders.filter(o => (o.created_at ?? "").slice(0, 10) === today).reduce((a, o) => a + (o.total_cents ?? 0), 0);
    const pending = orders.filter(o => o.payment_status === "pendiente" || o.shipping_status === "pendiente").length;
    const lowStock = products.filter(p => ((p.product_variants ?? []).reduce((a: number, v: any) => a + (v.stock ?? 0), 0)) <= 3).length;
    return { total, salesToday, pending, lowStock };
  }, [orders, products]);

  const saveProduct = async () => {
    const { supabase } = await import("@/lib/supabase");
    const payload = { slug: form.slug, name: form.name, description: form.description, price_cents: Number(form.price_cents), category: form.category, active: form.active, status: form.active ? "activo" : "archivado" };
    let productId = form.id;
    if (form.id) await supabase.from("products").update(payload).eq("id", form.id);
    else {
      const { data } = await supabase.from("products").insert(payload).select("id").single();
      productId = data?.id;
      if (productId) await supabase.from("product_variants").insert({ product_id: productId, size: "Única", color: "Default", stock: Number(form.stock) || 0 });
    }
    if (productId && form.image_url) {
      await supabase.from("product_images").insert({ product_id: productId, image_url: form.image_url, sort_order: 0 });
    }
    setForm({ id: "", slug: "", name: "", description: "", price_cents: 0, stock: 0, category: "", active: true, status: "activo", image_url: "" });
    void load();
  };

  const softDelete = async (id: string) => {
    const { supabase } = await import("@/lib/supabase");
    await supabase.from("products").update({ active: false, status: "archivado" }).eq("id", id);
    void load();
  };

  const setOrderState = async (o: any, next: OrderState) => {
    const { supabase } = await import("@/lib/supabase");
    const patch: any = {};
    if (next === "pendiente") { patch.payment_status = "pendiente"; patch.shipping_status = "pendiente"; }
    if (next === "pagado") patch.payment_status = "pagado";
    if (next === "preparando" || next === "enviado") patch.shipping_status = next;
    if (next === "cancelado") { patch.payment_status = "cancelado"; patch.shipping_status = "cancelado"; }
    await supabase.from("orders").update(patch).eq("id", o.id);
    await supabase.from("order_status_history").insert({ order_id: o.id, status: next });
    void load();
  };

  return <div className="space-y-6">
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
      ["Total vendido", metrics.total], ["Ventas de hoy", metrics.salesToday], ["Pedidos pendientes", metrics.pending], ["Productos bajo stock", metrics.lowStock]
    ].map(([label, value]) => <div key={String(label)} className="panel p-4"><p className="text-xs text-white/60">{label}</p><p className="mt-2 text-2xl font-semibold">{typeof value === "number" && label !== "Pedidos pendientes" && label !== "Productos bajo stock" ? `$${(value/100).toLocaleString("es-AR")}` : String(value)}</p></div>)}</section>

    <section className="panel p-4"><h2 className="text-xl font-semibold">Gestión de productos</h2>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <input placeholder="slug" value={form.slug} onChange={e=>setForm({...form,slug:e.target.value})} className="rounded border border-white/20 bg-transparent p-2"/>
        <input placeholder="nombre" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className="rounded border border-white/20 bg-transparent p-2"/>
        <input placeholder="categoría" value={form.category} onChange={e=>setForm({...form,category:e.target.value})} className="rounded border border-white/20 bg-transparent p-2"/>
        <input type="number" placeholder="precio en centavos" value={form.price_cents} onChange={e=>setForm({...form,price_cents:Number(e.target.value)})} className="rounded border border-white/20 bg-transparent p-2"/>
        <input type="number" placeholder="stock inicial" value={form.stock} onChange={e=>setForm({...form,stock:Number(e.target.value)})} className="rounded border border-white/20 bg-transparent p-2"/>
        <input placeholder="URL imagen" value={form.image_url} onChange={e=>setForm({...form,image_url:e.target.value})} className="rounded border border-white/20 bg-transparent p-2"/>
      </div>
      <textarea placeholder="descripción" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} className="mt-2 w-full rounded border border-white/20 bg-transparent p-2"/>
      <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Activo</label>
      <button onClick={saveProduct} className="mt-3 rounded-full bg-white px-5 py-2 text-black">{form.id?"Guardar cambios":"Crear producto"}</button>
      <div className="mt-4 space-y-2">{products.map(p=><div key={p.id} className="rounded-xl border border-white/10 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><strong>{p.name}</strong> · {p.category ?? "General"} · ${(p.price_cents/100).toLocaleString("es-AR")} · {(p.product_variants??[]).reduce((a:number,v:any)=>a+(v.stock??0),0)}u</div><div className="flex gap-2"><button onClick={()=>setForm({id:p.id,slug:p.slug,name:p.name,description:p.description??"",price_cents:p.price_cents,stock:(p.product_variants??[])[0]?.stock??0,category:p.category??"",active:!!p.active,status:p.status??"activo",image_url:p.product_images?.[0]?.image_url??""})} className="rounded border border-white/20 px-3 py-1">Editar</button><button onClick={()=>void softDelete(p.id)} className="rounded border border-red-300/60 px-3 py-1 text-red-200">Desactivar</button></div></div></div>)}</div>
    </section>

    <section className="panel p-4"><h2 className="text-xl font-semibold">Pedidos</h2>{loading?<p className="mt-2">Cargando...</p>:<div className="mt-3 space-y-3">{orders.map(o=>{const state:OrderState=o.payment_status==="cancelado"?"cancelado":o.shipping_status==="enviado"?"enviado":o.shipping_status==="preparando"?"preparando":o.payment_status==="pagado"?"pagado":"pendiente";return <div key={o.id} className="rounded-xl border border-white/10 p-3"><div className="text-xs text-white/60">{o.id}</div><div>Cliente: {o.customers?.email ?? o.customer_id}</div><div>Total: ${(o.total_cents/100).toLocaleString("es-AR")}</div><ul className="ml-5 list-disc text-sm">{(itemsByOrder[o.id]??[]).map((it:any,i:number)=><li key={i}>{it.products?.name ?? "Producto"} x{it.qty}</li>)}</ul><select value={state} onChange={e=>void setOrderState(o,e.target.value as OrderState)} className="mt-2 rounded border border-white/20 bg-transparent p-2">{orderStates.map(s=><option key={s} value={s}>{s}</option>)}</select></div>})}</div>}</section>
  </div>;
}
