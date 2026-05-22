"use client";
import { useAuth } from "@/components/auth-provider";
import { useEffect, useState } from "react";

const statuses=["idea","escribiendo","grabando","mezclando","master","lanzado"];
export default function Page(){
 const {user}=useAuth(); const [rows,setRows]=useState<any[]>([]); const [title,setTitle]=useState("");
 const load=async()=>{if(!user)return;const {supabase}=await import("@/lib/supabase");const {data}=await supabase.from("flow_music_tracks").select("*").eq("owner_id",user.id).order("created_at",{ascending:false});setRows(data??[])};
 useEffect(()=>{void load();},[user]);
 const create=async()=>{if(!user||!title)return;const {supabase}=await import("@/lib/supabase");await supabase.from("flow_music_tracks").insert({owner_id:user.id,title,status:"idea"});setTitle("");void load();};
 return <div className="panel p-6"><h1 className="text-2xl font-bold">Music System</h1><div className="mt-3 flex gap-2"><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Nueva canción" className="rounded border border-white/20 bg-transparent p-2"/><button onClick={create} className="rounded bg-white px-3 text-black">Crear</button></div><div className="mt-4 space-y-2">{rows.map(r=><div key={r.id} className="rounded border border-white/10 p-3"><div>{r.title}</div><select value={r.status||"idea"} onChange={async e=>{const {supabase}=await import("@/lib/supabase");await supabase.from("flow_music_tracks").update({status:e.target.value}).eq("id",r.id);void load();}}>{statuses.map(s=><option key={s}>{s}</option>)}</select></div>)}</div></div>
}
