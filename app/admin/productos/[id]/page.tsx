"use client";
import { useEffect, useState } from "react";

export default function Page({params}:{params:Promise<{id:string}>}){
 const [id,setId]=useState(""); const [f,setF]=useState<any>(null);
 useEffect(()=>{params.then(p=>setId(p.id));},[params]);
 useEffect(()=>{if(!id)return;void(async()=>{const {supabase}=await import("@/lib/supabase");const {data}=await supabase.from("products").select("id,name,slug,price_cents,active,category,description,status").eq("id",id).single();setF(data);})();},[id]);
 const save=async()=>{const {supabase}=await import("@/lib/supabase");await supabase.from("products").update(f).eq("id",id)};
 if(!f) return <div className="panel p-6">Cargando...</div>;
 return <div className="panel p-6 space-y-2"><h1 className="text-2xl font-bold">Editar producto</h1>{["name","slug","price_cents","category","description","status"].map((k)=><input key={k} className="block w-full rounded border border-white/20 bg-transparent p-2" value={f[k]??""} onChange={e=>setF({...f,[k]:e.target.value})}/>)}<label><input type="checkbox" checked={f.active} onChange={e=>setF({...f,active:e.target.checked})}/> activo</label><button onClick={save} className="rounded bg-white px-4 py-2 text-black">Guardar</button></div>
}
