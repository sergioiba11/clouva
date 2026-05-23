"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NuevoProductoClient() {
  const [f, setF] = useState({ name: "", slug: "", price_cents: 0, category: "", active: true, description: "", vip_only: false, featured: false, image: "", stock: 0, size: "U", color: "Black" });
  const r = useRouter();

  const save = async () => {
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase.from("products").insert({ name: f.name, slug: f.slug, price_cents: Number(f.price_cents), category: f.category, active: f.active, description: f.description, status: f.stock > 0 ? "activo" : "agotado", vip_only: f.vip_only, featured: f.featured }).select("id").single();
    if (!data) return;
    await supabase.from("product_images").insert({ product_id: data.id, image_url: f.image, sort_order: 0 });
    await supabase.from("product_variants").insert({ product_id: data.id, size: f.size, color: f.color, stock: Number(f.stock) });
    r.push(`/admin/productos/${data.id}`);
  };

  return <div className="panel p-6 space-y-2"><h1 className="text-2xl font-bold">Nuevo producto</h1>{Object.keys(f).filter((k) => k !== "active" && k !== "vip_only" && k !== "featured").map((k) => <input key={k} placeholder={k} className="block w-full rounded border border-white/20 bg-transparent p-2" value={(f as any)[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />)}<label><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> activo</label><label><input type="checkbox" checked={f.vip_only} onChange={(e) => setF({ ...f, vip_only: e.target.checked })} /> vip</label><label><input type="checkbox" checked={f.featured} onChange={(e) => setF({ ...f, featured: e.target.checked })} /> destacado</label><label><input type="checkbox" checked={!!f.vip_only} onChange={(e) => setF({ ...f, vip_only: e.target.checked })} /> vip</label><label><input type="checkbox" checked={!!f.featured} onChange={(e) => setF({ ...f, featured: e.target.checked })} /> destacado</label><button onClick={save} className="rounded bg-white px-4 py-2 text-black">Crear</button></div>;
}
