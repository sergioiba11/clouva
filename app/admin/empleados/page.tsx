"use client";
import { useEffect, useState } from "react";

export default function Page(){
 const [rows,setRows]=useState<any[]>([]);
 const [email,setEmail]=useState("");
 const load=async()=>{const {supabase}=await import("@/lib/supabase");const {data}=await supabase.from("profiles").select("id,full_name,role,role_v2").or("role.eq.admin,role.eq.customer,role.eq.owner");setRows(data??[])};
 useEffect(()=>{void load();},[]);
 const makeEmployee=async()=>{const {supabase}=await import("@/lib/supabase");const {data:u}=await supabase.from("customers").select("profile_id,email").eq("email",email).maybeSingle();if(!u?.profile_id)return;await supabase.from("profiles").update({role_v2:"employee"}).eq("id",u.profile_id);setEmail("");void load();};
 return <div className="panel p-6"><h1 className="text-2xl font-bold">Empleados</h1><div className="mt-3 flex gap-2"><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="email existente" className="rounded border border-white/20 bg-transparent p-2"/><button onClick={makeEmployee} className="rounded bg-white px-3 py-2 text-black">Crear empleado</button></div><p className="mt-2 text-xs text-white/60">No pueden crear admins ni tocar configuración sensible.</p><div className="mt-4 space-y-2">{rows.map(r=><div key={r.id} className="rounded border border-white/10 p-2">{r.full_name||r.id} · role={r.role} · role_v2={r.role_v2}</div>)}</div></div>
}
