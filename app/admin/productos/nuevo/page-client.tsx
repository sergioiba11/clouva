"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

const slugify = (v: string) => v.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)+/g, "");

export default function NuevoProductoClient() {
  const [f, setF] = useState({ name: "", slug: "", price_cents: 0, category: "streetwear", active: true, description: "", vip_only: false, featured: false, image: "", stock: 0, size: "U", color: "Negro" });
  const r = useRouter();
  const price = useMemo(() => (Number(f.price_cents || 0) / 100).toLocaleString("es-AR", { style: "currency", currency: "ARS" }), [f.price_cents]);

  const save = async () => {
    const { supabase } = await import("@/lib/supabase");
    const slug = f.slug || slugify(f.name);
    const { data } = await supabase.from("products").insert({ name: f.name, slug, price_cents: Number(f.price_cents), category: f.category, active: f.active, description: f.description, status: f.stock > 3 ? "activo" : "low_stock", vip_only: f.vip_only, featured: f.featured }).select("id").single();
    if (!data) return;
    if (f.image) await supabase.from("product_images").insert({ product_id: data.id, image_url: f.image, sort_order: 0 });
    await supabase.from("product_variants").insert({ product_id: data.id, size: f.size, color: f.color, stock: Number(f.stock) });
    r.push(`/admin/productos/${data.id}`);
  };

  return <div className="panel space-y-4 p-6"><h1 className="text-2xl font-bold">Crear producto</h1><div className="grid gap-4 md:grid-cols-2"><label className="text-sm">Nombre<input className="mt-1 block w-full rounded border border-white/20 bg-transparent p-2" value={f.name} onChange={(e)=>setF({...f,name:e.target.value,slug:slugify(e.target.value)})}/></label><label className="text-sm">Slug<input className="mt-1 block w-full rounded border border-white/20 bg-transparent p-2" value={f.slug} onChange={(e)=>setF({...f,slug:e.target.value})}/></label><label className="text-sm">Precio (centavos)<input type="number" className="mt-1 block w-full rounded border border-white/20 bg-transparent p-2" value={f.price_cents} onChange={(e)=>setF({...f,price_cents:Number(e.target.value)})}/><span className="text-xs text-white/60">{price}</span></label><label className="text-sm">Stock<input type="number" className="mt-1 block w-full rounded border border-white/20 bg-transparent p-2" value={f.stock} onChange={(e)=>setF({...f,stock:Number(e.target.value)})}/></label><label className="text-sm">Categoría<select className="mt-1 block w-full rounded border border-white/20 bg-transparent p-2" value={f.category} onChange={(e)=>setF({...f,category:e.target.value})}><option value="streetwear">Streetwear</option><option value="digital">Digital</option><option value="accesorios">Accesorios</option></select></label><label className="text-sm">Imagen (URL)<input className="mt-1 block w-full rounded border border-white/20 bg-transparent p-2" value={f.image} onChange={(e)=>setF({...f,image:e.target.value})}/></label><label className="text-sm">Talla<input className="mt-1 block w-full rounded border border-white/20 bg-transparent p-2" value={f.size} onChange={(e)=>setF({...f,size:e.target.value})}/></label><label className="text-sm">Color<input className="mt-1 block w-full rounded border border-white/20 bg-transparent p-2" value={f.color} onChange={(e)=>setF({...f,color:e.target.value})}/></label></div><label className="text-sm">Descripción<textarea className="mt-1 block w-full rounded border border-white/20 bg-transparent p-2" value={f.description} onChange={(e)=>setF({...f,description:e.target.value})}/></label><div className="flex gap-4 text-sm"><label><input type="checkbox" checked={f.active} onChange={(e)=>setF({...f,active:e.target.checked})}/> Activo</label><label><input type="checkbox" checked={f.vip_only} onChange={(e)=>setF({...f,vip_only:e.target.checked})}/> VIP</label><label><input type="checkbox" checked={f.featured} onChange={(e)=>setF({...f,featured:e.target.checked})}/> Destacado</label></div><div className="sticky bottom-3"><button onClick={save} className="rounded bg-white px-4 py-2 text-black">Guardar producto</button></div></div>;
}
