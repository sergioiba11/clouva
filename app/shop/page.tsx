"use client";
import { useEffect, useState } from "react";
import { MainFooter, MainNav } from "@/components/layout";
import Link from "next/link";

type P={id:string;slug:string;name:string;price_cents:number;category:string|null;active:boolean};
export default function ShopPage(){
 const [products,setProducts]=useState<P[]>([]);
 useEffect(()=>{void (async()=>{const {supabase}=await import("@/lib/supabase");const {data}=await supabase.from("products").select("id,slug,name,price_cents,category,active").eq("active",true).order("name");setProducts((data??[]) as P[]);})();},[]);
 return <main><MainNav/><section className="mx-auto w-full max-w-7xl px-4 py-14 md:px-8"><h1 className="text-3xl">Shop CLOUVA</h1>{products.length===0?<div className="mt-8 rounded-3xl border border-white/10 p-6 text-white/70">No hay productos activos todavía.</div>:<div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{products.map(p=><Link key={p.id} href={`/producto/${p.slug}`} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5"><p className="text-xs text-white/60">{p.category??"General"}</p><h3 className="mt-2 text-xl">{p.name}</h3><p className="mt-2 text-[#95d8ff]">${(p.price_cents/100).toLocaleString("es-AR")}</p></Link>)}</div>}</section><MainFooter/></main>
}
