"use client";
import { useAuth } from "@/components/auth-provider";
import { useEffect, useState } from "react";

export default function Page(){
 const {user}=useAuth(); const [rows,setRows]=useState<any[]>([]); const [name,setName]=useState("");
 const load=async()=>{if(!user)return;const {supabase}=await import("@/lib/supabase");const {data}=await supabase.from("flow_businesses").select("*").eq("owner_id",user.id).order("created_at",{ascending:false});setRows(data??[])};
 useEffect(()=>{void load();},[user]);
 const create=async()=>{if(!user||!name)return;const {supabase}=await import("@/lib/supabase");await supabase.from("flow_businesses").insert({owner_id:user.id,name});setName("");void load();};
 return <div className="panel p-6"><h1 className="text-2xl font-bold">Negocios</h1><div className="mt-3 flex gap-2"><input value={name} onChange={e=>setName(e.target.value)} placeholder="Nuevo negocio/proyecto" className="rounded border border-white/20 bg-transparent p-2"/><button onClick={create} className="rounded bg-white px-3 text-black">Crear</button></div><div className="mt-4 space-y-2">{rows.map(r=><div key={r.id} className="rounded border border-white/10 p-3">{r.name} · Ingresos ${(r.estimated_income_cents/100).toLocaleString("es-AR")} · Gastos ${(r.expenses_cents/100).toLocaleString("es-AR")}</div>)}</div></div>
}
