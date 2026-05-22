"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ActivityFeed, GlowButton, ModuleCard, PremiumCard, StatCard } from "@/components/os-ui";

export default function MiFlowPage(){
const {user}=useAuth();
const [stats,setStats]=useState({launches:0,sales:0,stock:0,sessions:0,tasks:0});
useEffect(()=>{if(!user)return;void(async()=>{const {supabase}=await import('@/lib/supabase');const [a,b,c,d,e]=await Promise.all([supabase.from('flow_launches').select('id',{count:'exact',head:true}).eq('owner_id',user.id),supabase.from('orders').select('id',{count:'exact',head:true}),supabase.from('products').select('id',{count:'exact',head:true}).lt('stock',5),supabase.from('flow_studio_sessions').select('id',{count:'exact',head:true}).eq('owner_id',user.id),supabase.from('flow_tasks').select('id',{count:'exact',head:true}).eq('owner_id',user.id)]);setStats({launches:a.count??0,sales:b.count??0,stock:c.count??0,sessions:d.count??0,tasks:e.count??0});})();},[user]);
const mods=[["Flows","/mi-flow/flows"],["Studio","/mi-flow/studio"],["Vault","/mi-flow/vault"],["Launch","/mi-flow/launch"],["Visual","/mi-flow/visual"],["Store","/mi-flow/store"],["Money","/mi-flow/money"],["Tasks","/mi-flow/tasks"],["AI Assistant","/mi-flow/assistant"],["Lore","/mi-flow/lore"]];
return <div className="space-y-4"><PremiumCard className="p-6"><p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Dashboard</p><h1 className="mt-2 text-3xl font-semibold">Buen día, Flow</h1><div className="mt-4 flex flex-wrap gap-2"><GlowButton href="/mi-flow/flows">+ Flow</GlowButton><GlowButton href="/mi-flow/studio">Nueva sesión</GlowButton><GlowButton href="/mi-flow/tasks">Nueva tarea</GlowButton></div></PremiumCard><div className="grid gap-3 grid-cols-2 lg:grid-cols-5"><StatCard label="Lanzamientos" value={stats.launches}/><StatCard label="Ventas" value={stats.sales}/><StatCard label="Stock bajo" value={stats.stock}/><StatCard label="Sesiones" value={stats.sessions}/><StatCard label="Tareas" value={stats.tasks}/></div><div className="grid gap-4 lg:grid-cols-[1fr_.8fr]"><div className="grid gap-3 sm:grid-cols-2">{mods.map(([t,h])=><ModuleCard key={t} title={t} href={h}/>)}</div><ActivityFeed items={["Idea capturada","Beat marcado como favorito","Checklist launch actualizado"]}/></div></div>
}
