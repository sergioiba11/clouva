"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";

const modules = [
  ["Flows", "/mi-flow/flows"], ["Studio", "/mi-flow/studio"], ["Vault", "/mi-flow/vault"], ["Launch", "/mi-flow/launch"], ["Visual", "/mi-flow/visual"], ["Store", "/mi-flow/store"], ["Money", "/mi-flow/money"], ["Tasks", "/mi-flow/tasks"], ["AI Assistant", "/mi-flow/assistant"], ["Lore / Vida de Flows", "/mi-flow/lore"],
];

export default function MiFlowPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ launches: 0, sales: 0, lowStock: 0, sessions: 0, tasks: 0 });

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { supabase } = await import("@/lib/supabase");
      const [launches, sales, lowStock, sessions, tasks] = await Promise.all([
        supabase.from("flow_launches").select("id", { count: "exact", head: true }).eq("owner_id", user.id).neq("status", "Publicado"),
        supabase.from("orders").select("id", { count: "exact", head: true }),
        supabase.from("products").select("id", { count: "exact", head: true }).lt("stock", 5),
        supabase.from("flow_studio_sessions").select("id", { count: "exact", head: true }).eq("owner_id", user.id),
        supabase.from("flow_tasks").select("id", { count: "exact", head: true }).eq("owner_id", user.id).neq("status", "done"),
      ]);
      setStats({ launches: launches.count ?? 0, sales: sales.count ?? 0, lowStock: lowStock.count ?? 0, sessions: sessions.count ?? 0, tasks: tasks.count ?? 0 });
    };
    void load();
  }, [user]);

  return <div className="space-y-5">
    <section className="panel rounded-3xl border border-[#8f7cff]/25 bg-gradient-to-br from-[#100f1c]/90 to-[#07080f] p-6">
      <p className="text-xs uppercase tracking-[0.2em] text-[#93f7ff]">CLOUVA OS · Flow Clover App</p>
      <h1 className="mt-2 text-3xl font-semibold">Buen día, Flow</h1>
      <p className="text-sm text-white/70">Tu centro creativo, comercial y operativo en una sola app.</p>
    </section>
    <section className="grid gap-3 grid-cols-2 lg:grid-cols-5">{[["Lanzamientos",stats.launches],["Ventas",stats.sales],["Stock bajo",stats.lowStock],["Sesiones",stats.sessions],["Tareas",stats.tasks]].map(([k,v])=><article key={String(k)} className="panel rounded-2xl p-4"><p className="text-xs text-white/60">{String(k)}</p><p className="text-2xl font-bold">{String(v)}</p></article>)}</section>
    <section className="grid grid-cols-2 gap-3 md:grid-cols-5">{[["+ Flow","/mi-flow/flows"],["+ Idea","/mi-flow/flows"],["Nueva sesión","/mi-flow/studio"],["Crear producto","/admin/productos/nuevo"],["Nueva tarea","/mi-flow/tasks"]].map(([k,l])=><Link key={String(k)} href={String(l)} className="rounded-2xl border border-[#8f7cff]/30 bg-[#8f7cff]/10 p-3 text-sm">{String(k)}</Link>)}</section>
    <section className="grid gap-3 md:grid-cols-2">{modules.map(([name, href]) => <Link key={String(name)} href={String(href)} className="panel rounded-2xl border border-white/10 p-4">{String(name)}</Link>)}</section>
  </div>;
}
