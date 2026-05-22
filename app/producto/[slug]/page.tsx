"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MainFooter, MainNav } from "@/components/layout";
import { loadCart, saveCart } from "@/lib/cart";

export default function ProductDetail({ params }: { params: Promise<{ slug: string }> }) {
  const [slug,setSlug]=useState("");
  const [p,setP]=useState<any>(null); const [variant,setVariant]=useState("default");
  useEffect(()=>{params.then(v=>setSlug(v.slug));},[params]);
  useEffect(()=>{if(!slug)return;void(async()=>{const {supabase}=await import("@/lib/supabase");const {data}=await supabase.from("products").select("id,slug,name,description,price_cents,category,active,status,product_images(image_url),product_variants(id,size,color,stock)").eq("slug",slug).maybeSingle();setP(data);})();},[slug]);
  const add=()=>{if(!p)return;const cart=loadCart();const idx=cart.findIndex(i=>i.productId===p.id&&i.variant===variant);if(idx>=0)cart[idx].qty+=1;else cart.push({productId:p.id,slug:p.slug,name:p.name,priceCents:p.price_cents,qty:1,variant});saveCart(cart);};
  return <main><MainNav/><section className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 md:grid-cols-2 md:px-8">{!p?<div>Cargando...</div>:<><div className="aspect-square rounded-3xl border border-white/10 bg-white/[0.04] p-2"><img src={p.product_images?.[0]?.image_url||""} alt={p.name} className="h-full w-full rounded-2xl object-cover"/></div><div><p className="text-xs uppercase tracking-[0.2em] text-[#74c5ff]">{p.category??"Drop"}</p><h1 className="mt-3 text-4xl font-semibold">{p.name}</h1><p className="mt-4 max-w-md text-white/70">{p.description??"Sin descripción"}</p><p className="mt-6 text-2xl text-[#95d8ff]">${(p.price_cents/100).toLocaleString("es-AR")}</p><select className="mt-4 rounded border border-white/20 bg-transparent p-2" onChange={e=>setVariant(e.target.value)}>{(p.product_variants?.length?p.product_variants:[{id:"d",size:"Única",color:"-",stock:0}]).map((v:any)=><option key={v.id} value={`${v.size}-${v.color}`}>{v.size}/{v.color} · stock {v.stock??0}</option>)}</select><div className="mt-8 flex gap-3"><button onClick={add} className="rounded-full bg-white px-6 py-3 text-sm font-medium text-black">Agregar al carrito</button><Link className="rounded-full border border-white/30 px-6 py-3 text-sm" href="/carrito">Ir al carrito</Link></div></div></>}</section><MainFooter/></main>
}
