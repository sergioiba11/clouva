"use client";

import { useEffect, useState } from "react";
import { ActivityFeed, PremiumCard, StatCard } from "@/components/os-ui";
import { OfficialAvatarRigCard } from "@/components/admin/OfficialAvatarRigCard";

export default function AdminPage() {
  const [stats, setStats] = useState({ ventas: 0, pedidos: 0, productos: 0, clientes: 0, empleados: 0, vip: 0 });

  useEffect(() => {
    void (async () => {
      const { supabase } = await import("@/lib/supabase");
      const [pedidos, productos, clientes, empleados, vip] = await Promise.all([
        supabase.from("orders").select("id", { count: "exact", head: true }),
        supabase.from("products").select("id", { count: "exact", head: true }),
        supabase.from("customers").select("id", { count: "exact", head: true }),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "empleado"),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "vip"),
      ]);
      setStats({
        ventas: (pedidos.count ?? 0) * 100,
        pedidos: pedidos.count ?? 0,
        productos: productos.count ?? 0,
        clientes: clientes.count ?? 0,
        empleados: empleados.count ?? 0,
        vip: vip.count ?? 0,
      });
    })();
  }, []);

  return (
    <div className="space-y-4">
      <PremiumCard className="p-6">
        <h1 className="text-3xl font-semibold">Centro de Control CLOUVA</h1>
        <p className="text-[var(--muted)]">Business OS · Analytics · Operación</p>
      </PremiumCard>

      <OfficialAvatarRigCard />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {Object.entries(stats).map(([key, value]) => <StatCard key={key} label={key} value={value} />)}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PremiumCard className="p-5">
          <h3 className="text-sm uppercase tracking-[0.16em] text-[var(--muted)]">KPIs visuales</h3>
          <div className="mt-4 h-40 rounded-2xl border border-[var(--line)] bg-gradient-to-r from-[#8f7cff]/20 to-[#93f7ff]/10" />
        </PremiumCard>
        <ActivityFeed items={["Pedido #193 pagado", "Stock crítico en Hoodie", "Nuevo cliente VIP registrado"]} />
      </div>
    </div>
  );
}
