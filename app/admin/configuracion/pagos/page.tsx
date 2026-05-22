"use client";
import { useEffect, useState } from "react";

type PM={id:string;code:string;active:boolean;alias:string|null;cbu_cvu:string|null;holder:string|null;instructions:string|null;customer_notes:string|null;qr_image_url:string|null};
export default function Page(){
  const [items,setItems]=useState<PM[]>([]);
  const load=async()=>{const {supabase}=await import("@/lib/supabase");const {data}=await supabase.from("payment_methods").select("*").order("code");setItems((data??[]) as PM[])};
  useEffect(()=>{void load();},[]);
  const save=async(i:PM)=>{const {supabase}=await import("@/lib/supabase");await supabase.from("payment_methods").update(i).eq("id",i.id);};
  return <div className="panel p-6"><h1 className="text-2xl font-bold">Configuración de pagos</h1><div className="mt-4 space-y-4">{items.map(i=><div key={i.id} className="rounded-xl border border-white/10 p-3 space-y-2"><div className="flex items-center gap-2"><strong>{i.code}</strong><label><input type="checkbox" checked={i.active} onChange={e=>setItems(items.map(x=>x.id===i.id?{...x,active:e.target.checked}:x))}/> activo</label></div>{["alias","cbu_cvu","holder","instructions","customer_notes","qr_image_url"].map((k)=><input key={k} value={(i as any)[k]??""} onChange={e=>setItems(items.map(x=>x.id===i.id?{...x,[k]:e.target.value}:x))} placeholder={k} className="w-full rounded border border-white/20 bg-transparent p-2"/>)}<button onClick={()=>save(i)} className="rounded bg-white px-3 py-1 text-black">Guardar</button></div>)}</div></div>
}
