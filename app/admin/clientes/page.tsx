"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function Page(){
 const [rows,setRows]=useState<any[]>([]);
 const load=async()=>{const {supabase}=await import("@/lib/supabase");const {data}=await supabase.from("profiles").select("id,full_name,avatar_url,is_vip,is_blocked,clouva_id,username").order("full_name");setRows(data??[])};
 useEffect(()=>{void load();},[]);
 const patch=async(id:string,fields:any)=>{const {supabase}=await import("@/lib/supabase");await supabase.from("profiles").update(fields).eq("id",id);void load();};
 return <div className="panel p-6"><h1 className="text-2xl font-bold">Clientes</h1><div className="mt-4 space-y-2">{rows.map(r=><div key={r.id} className="rounded-xl border border-white/10 p-3"><div className="text-sm">{r.full_name||r.id} · {r.clouva_id}</div><div className="text-xs text-white/60">VIP: {r.is_vip?"Sí":"No"} · Bloqueado: {r.is_blocked?"Sí":"No"}</div><div className="mt-2 flex gap-2"><button onClick={()=>patch(r.id,{is_vip:!r.is_vip})} className="rounded border px-2 py-1">VIP</button><button onClick={()=>patch(r.id,{is_blocked:!r.is_blocked})} className="rounded border px-2 py-1">Bloquear</button><Link href={`/perfil-publico/${r.id}`} className="rounded border px-2 py-1">Perfil público</Link></div></div>)}</div></div>
}
