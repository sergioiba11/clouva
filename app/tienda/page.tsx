"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MainFooter, MainNav } from "@/components/layout";
import { ProductCard } from "@/components/store/product-card";
import { supabase } from "@/lib/supabase";
import { productSelect, type Banner, type Category, type Product } from "@/lib/store-data";

export default function StoreHome() {
  const [products, setProducts] = useState<Product[]>([]); const [categories, setCategories] = useState<Category[]>([]); const [banners, setBanners] = useState<Banner[]>([]);
  useEffect(()=>{void(async()=>{const [ps,cs,bs]=await Promise.all([supabase.from("products").select(productSelect).eq("active",true).eq("featured",true).limit(6),supabase.from("categories").select("*").limit(4),supabase.from("banners").select("*").eq("active",true).order("sort_order")]); setProducts((ps.data??[]) as Product[]); setCategories(cs.data??[]); setBanners(bs.data??[]);})();},[]);
  const hero = banners[0];
  return <main><MainNav/><section className="mx-auto max-w-7xl px-4 py-10 md:px-8"><div className="overflow-hidden rounded-[2.5rem] border border-white/10 bg-white/[0.04]"><div className="grid min-h-[520px] items-end bg-cover bg-center p-8 md:p-14" style={{backgroundImage: hero?.image_url ? `linear-gradient(90deg, rgba(0,0,0,.75), rgba(0,0,0,.15)), url(${hero.image_url})` : "radial-gradient(circle at top right, rgba(149,216,255,.25), transparent 40%)"}}><div><p className="text-xs uppercase tracking-[0.25em] text-white/60">Clouva Store</p><h1 className="mt-3 max-w-2xl text-5xl font-semibold md:text-7xl">{hero?.title ?? "Premium essentials para tu drop"}</h1><p className="mt-4 max-w-xl text-white/65">{hero?.subtitle ?? "Tienda editable conectada a Supabase: productos, banners, categorías y pedidos desde /admin."}</p><Link href="/catalogo" className="mt-8 inline-block rounded-full bg-white px-6 py-3 font-semibold text-black">Comprar ahora</Link></div></div></div><h2 className="mt-14 text-2xl font-semibold">Productos destacados</h2><div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{products.map((p)=><ProductCard key={p.id} product={p}/>)}</div><h2 className="mt-14 text-2xl font-semibold">Categorías destacadas</h2><div className="mt-6 grid gap-4 md:grid-cols-4">{categories.map((c)=><Link key={c.id} href={`/catalogo?category=${c.id}`} className="rounded-[2rem] border border-white/10 p-6">{c.name}</Link>)}</div></section><MainFooter/></main>;
}
