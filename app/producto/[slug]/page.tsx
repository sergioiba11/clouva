"use client";
import { useEffect, useState } from "react";
import { MainFooter, MainNav } from "@/components/layout";
import { AddToCart } from "@/components/store/add-to-cart";
import { supabase } from "@/lib/supabase";
import { productSelect, type Product } from "@/lib/store-data";
import { money } from "@/lib/store-utils";

export default function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const [product, setProduct] = useState<Product | null>(null);
  useEffect(()=>{void(async()=>{const { slug } = await params; const { data } = await supabase.from("products").select(productSelect).eq("slug", slug).maybeSingle(); setProduct(data as Product | null);})();},[params]);
  if (!product) return <main><MainNav/><div className="p-10">Cargando producto...</div></main>;
  return <main><MainNav/><section className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-2 md:px-8"><div className="grid gap-4">{product.product_images?.length ? product.product_images.map((img)=><img key={img.id} src={img.image_url} alt={product.name} className="rounded-[2rem]"/>) : <div className="aspect-square rounded-[2rem] bg-white/5"/>}</div><div className="md:sticky md:top-8 md:h-fit"><p className="text-sm uppercase tracking-[0.2em] text-white/45">{product.categories?.name ?? "CLOUVA"}</p><h1 className="mt-3 text-5xl font-semibold">{product.name}</h1><div className="mt-5 flex gap-3 text-2xl"><span>{money(product.price)}</span>{product.old_price ? <span className="text-white/35 line-through">{money(product.old_price)}</span> : null}</div><p className="mt-6 text-white/65">{product.description}</p><p className="mt-4 text-sm text-white/45">SKU {product.sku ?? "—"} · Stock {product.stock}</p><div className="mt-8"><AddToCart product={product}/></div></div></section><MainFooter/></main>;
}
