"use client";

import Link from "next/link";
import { Search, SlidersHorizontal, Store, Box, MapPin } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MainNav, MainFooter } from "@/components/layout";
import { ProductCard } from "@/components/store/product-card";
import { commerceProductCategory, commerceProductSelect, type CommerceProduct } from "@/lib/commerce-store-data";
import { supabase } from "@/lib/supabase";

export default function MarketPage() {
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todo");

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("commerce_products")
        .select(commerceProductSelect)
        .in("status", ["published", "active", "incomplete"])
        .order("created_at", { ascending: false })
        .limit(60);
      setProducts((data ?? []) as unknown as CommerceProduct[]);
    })();
  }, []);

  const categories = useMemo(() => ["Todo", ...new Set(products.map(commerceProductCategory))], [products]);
  const visible = useMemo(() => products.filter((product) => {
    const matchesCategory = category === "Todo" || commerceProductCategory(product) === category;
    const needle = query.trim().toLocaleLowerCase("es");
    const matchesQuery = !needle || `${product.name} ${product.description ?? ""} ${commerceProductCategory(product)}`.toLocaleLowerCase("es").includes(needle);
    return matchesCategory && matchesQuery;
  }), [products, category, query]);

  return (
    <main className="min-h-screen bg-[#050507] text-white">
      <MainNav />
      <section className="mx-auto max-w-7xl px-4 pb-24 pt-7 md:px-8 md:pt-12">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-violet-300/70">CLOUVA MARKET</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight md:text-6xl">Todo vive acá.</h1>
            <p className="mt-3 max-w-xl text-sm text-white/50 md:text-base">Productos de Players, marcas y Studios. Físicos, digitales y gemelos 3D dentro del mismo universo.</p>
          </div>
          <Link href="/tienda" className="hidden rounded-full border border-white/10 bg-white/[.04] px-5 py-3 text-sm md:inline-flex">CLOUVA Store</Link>
        </div>

        <div className="mt-7 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[.055] p-2">
          <Search size={19} className="ml-2 text-white/40" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar productos, ropa, accesorios, Players..." className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-white/30" />
          <button type="button" aria-label="Filtros" className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-black/20"><SlidersHorizontal size={17} /></button>
        </div>

        <div className="mt-5 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none]">
          {categories.map((item) => <button key={item} type="button" onClick={() => setCategory(item)} className={`whitespace-nowrap rounded-full border px-4 py-2 text-xs ${category === item ? "border-violet-300/50 bg-violet-400/15 text-white" : "border-white/10 bg-white/[.03] text-white/55"}`}>{item}</button>)}
        </div>

        <div className="mt-6 grid grid-cols-3 gap-2 md:hidden">
          <Link href="/tienda" className="rounded-2xl border border-white/10 bg-white/[.035] p-4"><Store size={18} /><strong className="mt-3 block text-xs">CLOUVA Store</strong></Link>
          <button type="button" className="rounded-2xl border border-white/10 bg-white/[.035] p-4 text-left"><Box size={18} /><strong className="mt-3 block text-xs">Productos 3D</strong></button>
          <button type="button" className="rounded-2xl border border-white/10 bg-white/[.035] p-4 text-left"><MapPin size={18} /><strong className="mt-3 block text-xs">Cerca tuyo</strong></button>
        </div>

        <div className="mt-10 flex items-center justify-between"><h2 className="text-xl font-semibold md:text-2xl">Explorar Market</h2><span className="text-xs text-white/35">{visible.length} productos</span></div>
        {visible.length ? <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-2 md:gap-5 lg:grid-cols-4">{visible.map((product) => <ProductCard key={product.id} product={product} />)}</div> : <div className="mt-5 rounded-[2rem] border border-white/10 bg-white/[.025] px-6 py-14 text-center text-sm text-white/45">Los productos publicados van a aparecer acá automáticamente.</div>}
      </section>
      <MainFooter />
    </main>
  );
}
