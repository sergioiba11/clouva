"use client";
import { useEffect, useState } from "react";

export default function Page({params}:{params:Promise<{id:string}>}){
  const [id,setId]=useState(""); const [rows,setRows]=useState<any[]>([]);
  useEffect(()=>{params.then(p=>setId(p.id));},[params]);
  const load=async(pid:string)=>{const {supabase}=await import("@/lib/supabase");const {data}=await supabase.from("product_images").select("id,image_url,sort_order").eq("product_id",pid).order("sort_order");setRows(data??[])};
  useEffect(()=>{if(id) void load(id);},[id]);
  const upload=async(f:File)=>{const {supabase}=await import("@/lib/supabase");const path=`${id}/${Date.now()}-${f.name}`;await supabase.storage.from("product-images").upload(path,f,{upsert:true});const {data:{publicUrl}}=supabase.storage.from("product-images").getPublicUrl(path);await supabase.from("product_images").insert({product_id:id,image_url:publicUrl,sort_order:rows.length});void load(id);};
  const setMain=async(img:any)=>{const {supabase}=await import("@/lib/supabase");await supabase.from("product_images").update({sort_order:999}).eq("product_id",id);await supabase.from("product_images").update({sort_order:0}).eq("id",img.id);void load(id);};
  const del=async(img:any)=>{const {supabase}=await import("@/lib/supabase");await supabase.from("product_images").delete().eq("id",img.id);void load(id);};
  return <div className="panel p-6"><h1 className="text-2xl">Imágenes producto</h1><input type="file" onChange={e=>{const f=e.target.files?.[0];if(f) void upload(f);}} className="mt-3"/><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{rows.map(r=><div key={r.id} className="rounded-xl border border-white/10 p-2"><img src={r.image_url} className="aspect-square w-full rounded object-cover"/><div className="mt-2 flex gap-2"><button onClick={()=>setMain(r)} className="rounded border px-2 py-1 text-xs">Principal</button><button onClick={()=>del(r)} className="rounded border px-2 py-1 text-xs">Borrar</button></div></div>)}</div></div>
}
