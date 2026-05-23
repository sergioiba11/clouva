"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";

type Product = { id: string; slug: string; name: string; description: string | null; price_cents: number; category: string | null; product_variants: { stock: number }[]; product_images: { image_url: string }[] };

export default function MiFlowStorePage() {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState("");

  const load = async () => {
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase.from("products").select("id,slug,name,description,price_cents,category,product_variants(stock),product_images(image_url)").eq("active", true).eq("status", "activo").order("name");
    const filtered = (data ?? []).filter((p: any) => (p.product_variants ?? []).reduce((a: number, v: any) => a + (v.stock ?? 0), 0) > 0);
    setProducts(filtered as Product[]);
  };

  useEffect(() => { void load(); }, []);
  const total = useMemo(() => Object.entries(cart).reduce((acc, [id, qty]) => acc + (products.find(p => p.id === id)?.price_cents ?? 0) * qty, 0), [cart, products]);

  const placeOrder = async () => {
    if (!user) { setMsg("Iniciá sesión para confirmar pedido."); return; }
    const { supabase } = await import("@/lib/supabase");
    const entries = Object.entries(cart).filter(([, qty]) => qty > 0);
    if (!entries.length) { setMsg("El carrito está vacío."); return; }
    const { data: customer } = await supabase.from("customers").upsert({ profile_id: user.id, email: user.email }, { onConflict: "email" }).select("id").single();
    const { data: order, error } = await supabase.from("orders").insert({ customer_id: customer?.id, total_cents: total, payment_status: "pendiente", shipping_status: "pendiente" }).select("id").single();
    if (error || !order) { setMsg(error?.message ?? "No se pudo crear el pedido"); return; }
    const rows = entries.map(([id, qty]) => ({ order_id: order.id, product_id: id, qty, unit_price_cents: products.find(p => p.id === id)?.price_cents ?? 0 }));
    const { error: itemsError } = await supabase.from("order_items").insert(rows);
    if (itemsError) { setMsg(itemsError.message); return; }
    await supabase.from("order_status_history").insert({ order_id: order.id, status: "pendiente" });
    setCart({});
    setMsg(`Pedido confirmado: ${order.id}`);
    void load();
  };

  return <section className="mx-auto max-w-7xl space-y-4 px-4 py-6 md:px-6">
    <h1 className="text-3xl font-bold">CLOUVA Store</h1>
    <p className="text-sm text-white/70 light:text-black/70">Solo productos activos con stock disponible.</p>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{products.map(p => {
      const stock = (p.product_variants ?? []).reduce((a, v) => a + (v.stock ?? 0), 0);
      return <article key={p.id} className="panel p-4"><img src={p.product_images?.[0]?.image_url ?? ""} alt={p.name} className="h-52 w-full rounded-xl object-cover" /><p className="mt-2 text-xs text-white/60">{p.category ?? "General"}</p><h2 className="text-xl font-semibold">{p.name}</h2><p className="text-sm text-white/70">{p.description ?? ""}</p><p className="mt-2 text-lg text-[#95d8ff]">${(p.price_cents / 100).toLocaleString("es-AR")}</p><p className="text-xs">Stock: {stock}</p><div className="mt-2 flex items-center gap-2"><button disabled={stock <= 0} onClick={() => setCart(c => ({ ...c, [p.id]: Math.max(1, (c[p.id] ?? 0) + 1) }))} className="rounded border border-white/30 px-3 py-1 disabled:opacity-40">Agregar</button><span>{cart[p.id] ?? 0}</span></div></article>;
    })}</div>
    <div className="panel p-4"><p>Total carrito: ${(total / 100).toLocaleString("es-AR")}</p><button onClick={placeOrder} className="mt-2 rounded-full bg-white px-6 py-2 text-black">Confirmar pedido</button>{msg ? <p className="mt-2 text-sm">{msg}</p> : null}</div>
  </section>;
}
