"use client";
import { useEffect, useState } from "react";
import { MainFooter, MainNav } from "@/components/layout";

export default function Page({params}:{params:Promise<{id:string}>}){
 const [id,setId]=useState(""); const [p,setP]=useState<any>(null);
 useEffect(()=>{params.then(v=>setId(v.id));},[params]);
 useEffect(()=>{if(!id)return;void(async()=>{const {supabase}=await import("@/lib/supabase");const {data}=await supabase.from("profiles").select("id,full_name,avatar_url,is_vip,clouva_id,username").eq("id",id).maybeSingle();setP(data);})();},[id]);
 return <main><MainNav/><section className="mx-auto max-w-3xl p-8">{!p?<p>Cargando...</p>:<div className="panel p-6"><h1 className="text-2xl">{p.full_name||"Usuario CLOUVA"}</h1><p className="text-white/70">{p.clouva_id}</p>{p.is_vip?<p className="mt-2 text-amber-300">VIP</p>:null}</div>}</section><MainFooter/></main>
}
