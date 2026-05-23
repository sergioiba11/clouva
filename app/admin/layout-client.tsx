"use client";

import { MainNav } from "@/components/layout";
import { Sidebar } from "@/components/os-ui";
import { useAuth } from "@/components/auth-provider";
import { canAccessAdmin, roleHome } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const links = ["/admin", "/admin/productos", "/admin/ventas", "/admin/stock", "/admin/clientes", "/admin/empleados", "/admin/pedidos", "/admin/configuracion"];

export default function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  const { user, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (!canAccessAdmin(role)) router.replace(roleHome[role]);
  }, [loading, user, role, router]);

  if (loading) return <main><MainNav /><div className="mx-auto max-w-7xl p-6">Cargando sesión...</div></main>;
  if (!user || !canAccessAdmin(role)) return null;

  return <main><MainNav /><div className="mx-auto grid max-w-7xl gap-4 p-4 md:grid-cols-[240px_1fr] md:p-6"><Sidebar links={links} /><section>{children}</section></div></main>;
}
