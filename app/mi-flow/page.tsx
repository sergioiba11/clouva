"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth-provider";

type Order={id:string;total_cents:number;payment_status:string;shipping_status:string};
type DashboardData = {
  orders: number;
  products: number;
  customers: number;
  employees: number;
  vipUsers: number;
  tasks: number;
  notes: number;
  ideas: number;
};

const levelNames = ["Fundamentos", "Automatización", "IA Contextual", "Sistema Operativo", "Ecosistema Total"];

export default function MiFlowPage() {
  const { user, profile, role } = useAuth();
  const [data, setData] = useState<DashboardData>({ orders: 0, products: 0, customers: 0, employees: 0, vipUsers: 0, tasks: 0, notes: 0, ideas: 0 });
  const [ordersList,setOrdersList]=useState<Order[]>([]);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { supabase } = await import("@/lib/supabase");
      const [orders, products, customers, employees, vipUsers, tasks, notes, ideas] = await Promise.all([
        supabase.from("orders").select("id", { count: "exact", head: true }),
        supabase.from("products").select("id", { count: "exact", head: true }),
        supabase.from("customers").select("id", { count: "exact", head: true }),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "employee"),
        supabase.from("profiles").select("id", { count: "exact", head: true }).or("role.eq.vip,role_v2.eq.customer"),
        supabase.from("flow_tasks").select("id", { count: "exact", head: true }).eq("owner_id", user.id),
        supabase.from("flow_notes").select("id", { count: "exact", head: true }).eq("owner_id", user.id),
        supabase.from("flow_ideas").select("id", { count: "exact", head: true }).eq("owner_id", user.id),
      ]);

      const { data: myOrders } = await supabase.from("orders").select("id,total_cents,payment_status,shipping_status").order("id",{ascending:false}).limit(5);
      setOrdersList((myOrders ?? []) as Order[]);
      setData({
        orders: orders.count ?? 0,
        products: products.count ?? 0,
        customers: customers.count ?? 0,
        employees: employees.count ?? 0,
        vipUsers: vipUsers.count ?? 0,
        tasks: tasks.count ?? 0,
        notes: notes.count ?? 0,
        ideas: ideas.count ?? 0,
      });
    };
    void load();
  }, [user]);

  const roleLabel = useMemo(() => role.toUpperCase(), [role]);

  return (
    <div className="space-y-6">
      <section className="panel neon rounded-3xl border border-[#8f7cff]/25 bg-gradient-to-br from-[#100f1c]/90 to-[#07080f] p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-white/60">Perfil CLOUVA OS</p>
            <h1 className="mt-2 text-2xl font-semibold">{profile?.full_name ?? user?.email?.split("@")[0] ?? "Usuario"}</h1>
            <p className="text-sm text-white/70">{user?.email}</p>
            <p className="mt-1 text-xs text-white/50">Cuenta creada: {user?.created_at ? new Date(user.created_at).toLocaleDateString("es-AR") : "-"}</p>
          </div>
          <div className="flex gap-2">
            <span className="rounded-full border border-[#8f7cff]/40 bg-[#8f7cff]/20 px-3 py-1 text-xs tracking-[0.15em]">{roleLabel}</span>
            {role === "vip" ? <span className="rounded-full border border-amber-300/40 bg-amber-300/20 px-3 py-1 text-xs">VIP</span> : null}
            <Link href="/perfil" className="rounded-full border border-white/20 px-3 py-1 text-xs">Editar perfil</Link>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-3">
        {[
          ["Mis pedidos", data.orders, "/mi-flow"], ["Mis drops", data.products, "/mi-flow/drops"], ["Mi avatar", 1, "/mi-flow/avatar"],
          ["Mis notas", data.notes, "/mi-flow/contenido"], ["Mis tareas", data.tasks, "/mi-flow/tareas"], ["Mis ideas", data.ideas, "/mi-flow/ideas"],
          ["Mi música", 0, "/mi-flow/music"], ["Mi contenido", 0, "/mi-flow/contenido"], ["Roadmap", levelNames.length, "/mi-flow/roadmap"],
        ].map(([title, value, href]) => (
          <Link key={String(title)} href={String(href)} className="panel rounded-2xl border border-white/10 p-4 transition hover:border-[#8f7cff]/45">
            <p className="text-xs uppercase tracking-[0.15em] text-white/60">{String(title)}</p>
            <p className="mt-3 text-2xl font-semibold">{String(value)}</p>
          </Link>
        ))}
      </section>

      <section className="panel rounded-3xl p-6">
        <h2 className="text-lg font-semibold">Progreso CLOUVA OS</h2>
        <div className="mt-4 grid gap-2 md:grid-cols-5">{levelNames.map((l, i) => <div key={l} className="rounded-xl border border-white/10 p-3 text-sm">Nivel {i + 1}: {l}</div>)}</div>
      </section>

      <section className="panel rounded-3xl p-6"><h2 className="text-lg font-semibold">Mis pedidos</h2>{ordersList.length===0?<p className="mt-2 text-white/60">Todavía no tenés pedidos.</p>:<div className="mt-3 space-y-2">{ordersList.map((o)=><Link key={o.id} href={`/pedido/${o.id}`} className="block rounded-xl border border-white/10 p-3 text-sm">{o.id} · ${(o.total_cents/100).toLocaleString("es-AR")} · {o.payment_status} / {o.shipping_status}</Link>)}</div>}</section>

      {role === "admin" && (
        <section className="panel rounded-3xl border border-fuchsia-400/30 p-6">
          <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">Centro de control ADMIN</h2><Link className="rounded-full bg-fuchsia-500/20 px-4 py-2 text-xs" href="/admin">Entrar al Admin</Link></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[["Productos", data.products], ["Pedidos", data.orders], ["Clientes", data.customers], ["Empleados", data.employees], ["VIP", data.vipUsers], ["Ventas", data.orders], ["Actividad", data.tasks + data.notes + data.ideas], ["Configuración", 1]].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl border border-white/10 p-3"><p className="text-xs text-white/60">{String(k)}</p><p className="text-xl">{String(v)}</p></div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
