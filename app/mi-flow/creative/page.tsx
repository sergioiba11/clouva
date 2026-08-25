"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ActivityFeed, GlowButton, ModuleCard, PremiumCard, StatCard } from "@/components/os-ui";

const modules = [
  ["Notas creativas", "/mi-flow/flows"],
  ["Studio", "/mi-flow/studio"],
  ["Vault", "/mi-flow/vault"],
  ["Launch", "/mi-flow/launch"],
  ["Visual", "/mi-flow/visual"],
  ["Store", "/mi-flow/store"],
  ["Tasks", "/mi-flow/tasks"],
  ["AI Assistant", "/mi-flow/assistant"],
  ["Lore", "/mi-flow/lore"],
];

export default function CreativeCenterPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ launches: 0, sales: 0, stock: 0, sessions: 0, tasks: 0 });

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { supabase } = await import("@/lib/supabase");
      const [launches, sales, stock, sessions, tasks] = await Promise.all([
        supabase.from("flow_launches").select("id", { count: "exact", head: true }).eq("owner_id", user.id),
        supabase.from("orders").select("id", { count: "exact", head: true }),
        supabase.from("products").select("id", { count: "exact", head: true }).lt("stock", 5),
        supabase.from("flow_studio_sessions").select("id", { count: "exact", head: true }).eq("owner_id", user.id),
        supabase.from("flow_tasks").select("id", { count: "exact", head: true }).eq("owner_id", user.id),
      ]);
      setStats({ launches: launches.count ?? 0, sales: sales.count ?? 0, stock: stock.count ?? 0, sessions: sessions.count ?? 0, tasks: tasks.count ?? 0 });
    })();
  }, [user]);

  return (
    <div className="space-y-4">
      <PremiumCard className="p-6">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Herramientas CLOUVA</p>
        <h1 className="mt-2 text-3xl font-semibold">Centro creativo</h1>
        <div className="mt-4 flex flex-wrap gap-2">
          <GlowButton href="/mi-flow/flows">+ Nota creativa</GlowButton>
          <GlowButton href="/mi-flow/studio">Nueva sesión</GlowButton>
          <GlowButton href="/mi-flow/tasks">Nueva tarea</GlowButton>
        </div>
      </PremiumCard>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Lanzamientos" value={stats.launches} />
        <StatCard label="Ventas" value={stats.sales} />
        <StatCard label="Stock bajo" value={stats.stock} />
        <StatCard label="Sesiones" value={stats.sessions} />
        <StatCard label="Tareas" value={stats.tasks} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_.8fr]">
        <div className="grid gap-3 sm:grid-cols-2">{modules.map(([title, href]) => <ModuleCard key={title} title={title} href={href} />)}</div>
        <ActivityFeed items={["Idea capturada", "Beat marcado como favorito", "Checklist launch actualizado"]} />
      </div>
    </div>
  );
}
