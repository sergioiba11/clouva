"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function Page(){
 const [items,setItems]=useState<any[]>([]);
 useEffect(()=>{void(async()=>{const {supabase}=await import("@/lib/supabase");const {data}=await supabase.from("products").select("id,name,slug,price_cents,active,category,status").order("name");setItems(data??[]);})();},[]);
 return <div className="panel p-6"><div className="flex justify-between"><h1 className="text-2xl font-bold">Productos</h1><Link href="/admin/productos/nuevo">Nuevo producto</Link></div><div className="mt-4 space-y-2">{items.map(p=><Link key={p.id} href={`/admin/productos/${p.id}`} className="block rounded border border-white/10 p-3">{p.name} · ${(p.price_cents/100).toLocaleString("es-AR")} · {p.active?"Activo":"Inactivo"}</Link>)}</div></div>
}
