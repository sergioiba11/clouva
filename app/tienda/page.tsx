"use client";
import { MainNav } from "@/components/layout";
import { categories, products } from "@/lib/data";
import Link from "next/link";
import { useMemo, useState } from "react";

export default function Page(){
  const [q,setQ]=useState(""); const [cat,setCat]=useState("all");
  const filtered = useMemo(()=>products.filter(p=>(cat==="all"||p.category===cat)&&p.name.toLowerCase().includes(q.toLowerCase())),[q,cat]);
  return <main><MainNav/><section className="mx-auto max-w-7xl p-6"><div className="panel p-4"><div className="grid gap-3 md:grid-cols-[1fr_auto]"><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar producto..." className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"/><div className="flex flex-wrap gap-2">{["all",...categories].map(c=><button key={c} onClick={()=>setCat(c)} className={`rounded-xl px-3 py-2 text-sm ${cat===c?"bg-violet-600":"panel"}`}>{c}</button>)}</div></div></div><div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{filtered.map(p=><Link key={p.id} className="panel group p-4 transition hover:-translate-y-1" href={`/producto/${p.slug}`}><p className="text-xs text-violet-300">{p.category}</p><h2 className="text-xl">{p.name}</h2><p>${p.price}</p><p className="text-sm text-white/60">Stock {p.stock}</p><p className="mt-3 text-xs opacity-0 transition group-hover:opacity-100">Quick view</p></Link>)}</div></section></main>
}
