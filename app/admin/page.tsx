"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function AdminPage() {
  const [stats, setStats] = useState({ ventas: 0, pedidos: 0, productos: 0, clientes: 0, empleados: 0, vip: 0 });

  useEffect(() => {
    const load = async () => {
      const { supabase } = await import("@/lib/supabase");
      const [pedidos, productos, clientes, empleados, vip] = await Promise.all([
        supabase.from("orders").select("id", { count: "exact", head: true }),
        supabase.from("products").select("id", { count: "exact", head: true }),
        supabase.from("customers").select("id", { count: "exact", head: true }),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "owner"),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "customer"),
      ]);
      setStats({
        ventas: (pedidos.count ?? 0) * 100,
        pedidos: pedidos.count ?? 0,
        productos: productos.count ?? 0,
        clientes: clientes.count ?? 0,
        empleados: empleados.count ?? 0,
        vip: vip.count ?? 0,
      });
    };
    void load();
  }, []);

  const modules = ["tienda", "contenido", "comunidad", "automatizaciones", "creative system", "life system", "IA futura"];

  return (
    <div className="space-y-5">
      <div className="panel rounded-3xl border border-[#8f7cff]/30 p-6">
        <h1 className="text-2xl font-bold">TU CENTRO DE CONTROL</h1>
        <p className="text-white/65">Dashboard total de CLOUVA OS.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
        {Object.entries(stats).map(([k, v]) => <div key={k} className="panel rounded-2xl p-4"><p className="text-xs uppercase text-white/60">{k}</p><p className="text-2xl">{v}</p></div>)}
      </div>
      <div className="panel rounded-3xl p-6">
        <h2 className="text-lg font-semibold">Áreas del ecosistema</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{modules.map((m) => <div key={m} className="rounded-xl border border-white/10 p-3">{m}</div>)}</div>
        <div className="mt-6 flex flex-wrap gap-2">
          {["/admin/ventas", "/admin/pedidos", "/admin/productos", "/admin/stock", "/admin/clientes", "/admin/configuracion"].map((href) => (
            <Link key={href} href={href} className="rounded-full border border-white/20 px-3 py-1 text-xs">{href}</Link>
          ))}
        </div>
      </div>
    </div>
  );
}
