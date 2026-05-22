"use client";

import { MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
import { canAccessAdmin, roleHome } from "@/lib/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!canAccessAdmin(role)) {
      router.replace(roleHome[role]);
    }
  }, [loading, role, router, user]);

  const links = [
    "/admin",
    "/admin/tiendas",
    "/admin/productos",
    "/admin/ventas",
    "/admin/stock",
    "/admin/clientes",
    "/admin/empleados",
    "/admin/musica",
    "/admin/lanzamientos",
    "/admin/contenido",
    "/admin/youtube",
    "/admin/emails",
    "/admin/configuracion",
  ];

  if (loading) {
    return (
      <main>
        <MainNav />
        <div className="mx-auto max-w-7xl p-6 text-sm text-white/70">Cargando sesión...</div>
      </main>
    );
  }

  if (!user || !canAccessAdmin(role)) return null;

  return (
    <main>
      <MainNav />
      <div className="mx-auto grid max-w-7xl gap-4 p-6 md:grid-cols-[220px_1fr]">
        <aside className="panel p-3">
          {links.map((l) => (
            <Link key={l} href={l} className="block py-1 text-sm">
              {l}
            </Link>
          ))}
        </aside>
        <section>{children}</section>
      </div>
    </main>
  );
}
