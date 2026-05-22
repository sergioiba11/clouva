"use client";

import { MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function FlowLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, router, user]);

  const links = [
    "/mi-flow",
    "/mi-flow/avatar",
    "/mi-flow/ideas",
    "/mi-flow/tareas",
    "/mi-flow/finanzas",
    "/mi-flow/contenido",
    "/mi-flow/roadmap",
    "/mi-flow/music",
    "/mi-flow/negocios",
    "/mi-flow/drops",
  ];

  if (loading) {
    return (
      <main>
        <MainNav />
        <div className="mx-auto max-w-7xl p-6 text-sm text-white/70">Cargando sesión...</div>
      </main>
    );
  }

  if (!user) return null;

  return (
    <main>
      <MainNav />
      <div className="mx-auto grid max-w-7xl gap-4 p-6 md:grid-cols-[220px_1fr]">
        <aside className="panel neon p-3">
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
