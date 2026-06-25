"use client";
import { useEffect, useMemo, useState } from "react";
import { MainFooter, MainNav } from "@/components/layout";
import { ProductCard } from "@/components/store/product-card";
import { supabase } from "@/lib/supabase";
import { productSelect, type Category, type Product } from "@/lib/store-data";

export default function CatalogPage() {
  const [products, setProducts] = useState<Product[]>([]); const [categories, setCategories] = useState<Category[]>([]); const [q, setQ] = useState(""); const [category, setCategory] = useState(""); const [sort, setSort] = useState("recent");
  useEffect(() => { void (async () => { const [{ data: ps }, { data: cs }] = await Promise.all([supabase.from("products").select(productSelect).eq("active", true).order("created_at", { ascending: false }), supabase.from("categories").select("*").order("name")]); setProducts((ps ?? []) as Product[]); setCategories(cs ?? []); })(); }, []);
  const filtered = useMemo(() => products.filter((p) => (!q || p.name.toLowerCase().includes(q.toLowerCase())) && (!category || p.category_id === category)).sort((a, b) => sort === "price_asc" ? a.price - b.price : sort === "price_desc" ? b.price - a.price : +new Date(b.created_at) - +new Date(a.created_at)), [products, q, category, sort]);
  return <main><MainNav/><section className="mx-auto max-w-7xl px-4 py-14 md:px-8"><h1 className="text-4xl font-semibold">Catálogo</h1><div className="mt-6 grid gap-3 md:grid-cols-3"><input placeholder="Buscar" value={q} onChange={(e)=>setQ(e.target.value)} className="rounded-full bg-white/10 px-5 py-3"/><select value={category} onChange={(e)=>setCategory(e.target.value)} className="rounded-full bg-black px-5 py-3"><option value="">Todas las categorías</option>{categories.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}</select><select value={sort} onChange={(e)=>setSort(e.target.value)} className="rounded-full bg-black px-5 py-3"><option value="recent">Más recientes</option><option value="price_asc">Precio menor</option><option value="price_desc">Precio mayor</option></select></div><div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{filtered.map((p)=><ProductCard key={p.id} product={p}/>)}</div></section><MainFooter/></main>;
}
