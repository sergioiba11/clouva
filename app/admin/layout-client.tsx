"use client";

import { MainNav } from "@/components/layout";
import { Sidebar } from "@/components/os-ui";
import { useAuth } from "@/components/auth-provider";
import { canAccessAdmin, roleHome } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const links = ["/admin", "/admin/productos", "/admin/ventas", "/admin/stock", "/admin/clientes", "/admin/empleados", "/admin/pedidos", "/admin/configuracion"];

export default function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  const { user, session, role, loading, profile } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    const hasAdminAccess = canAccessAdmin(role);
    if (process.env.NEXT_PUBLIC_DEBUG_AUTH === "1") {
      const redirect = !user ? "/login" : hasAdminAccess ? null : roleHome[role];
      console.debug("[auth-debug] admin-layout:guard", {
        user,
        session,
        role,
        loading,
        profile,
        pathname,
        userId: user?.id ?? null,
        email: user?.email ?? null,
        canAccessAdmin: hasAdminAccess,
        redirect,
      });
    }
    if (!user) router.replace("/login");
    else if (!hasAdminAccess) router.replace(roleHome[role]);
  }, [loading, user, role, profile, router, pathname]);

  if (loading) return <main><MainNav /><div className="mx-auto max-w-7xl p-6">Cargando sesión...</div></main>;
  if (!user || !canAccessAdmin(role)) return null;

  return <main><MainNav /><div className="mx-auto grid max-w-7xl gap-4 p-4 md:grid-cols-[240px_1fr] md:p-6"><Sidebar links={links} /><section>{children}</section></div></main>;
}
