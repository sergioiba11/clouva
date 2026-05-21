"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";

export function RequireAuth({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, role, loading, hydrated } = useAuth();

  useEffect(() => {
    if (!hydrated || loading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (adminOnly && !(role === "owner" || role === "admin")) {
      router.replace("/");
    }
  }, [adminOnly, hydrated, loading, pathname, role, router, user]);

  if (!hydrated || loading) return <div className="p-8 text-white/70">Cargando sesión...</div>;
  if (!user) return null;
  if (adminOnly && !(role === "owner" || role === "admin")) return null;

  return <>{children}</>;
}
