"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Product = { id: string; name: string; slug: string; price: number; category: string };

export default function AdminProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName] = useState("");

  async function load() {
    const { data } = await supabase.from("products").select("id,name,slug,price,category").order("created_at", { ascending: false });
    setProducts((data as Product[]) ?? []);
  }
  useEffect(() => { void load(); }, []);

  async function createProduct() {
    await supabase.from("products").insert({ name, slug: name.toLowerCase().replaceAll(" ", "-"), price: 10000, category: "Drop" });
    setName("");
    await load();
  }

  async function remove(id: string) { await supabase.from("products").delete().eq("id", id); await load(); }

  return <div className="panel p-6"><h2 className="text-xl">Productos</h2><div className="mt-4 flex gap-2"><input value={name} onChange={e=>setName(e.target.value)} className="rounded bg-black/30 px-3 py-2" placeholder="Nuevo producto"/><button onClick={createProduct} className="rounded bg-white px-3 text-black">Agregar</button></div><ul className="mt-4 space-y-2">{products.map(p=><li key={p.id} className="flex items-center justify-between rounded border border-white/10 p-2"><span>{p.name} - ${p.price}</span><button onClick={()=>remove(p.id)} className="text-xs text-red-300">Borrar</button></li>)}</ul></div>;
}
