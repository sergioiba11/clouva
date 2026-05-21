"use client";
import { useAuth } from "@/components/auth/auth-provider";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { loading, user, role } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!user || role !== "admin")) router.replace("/login");
  }, [loading, role, router, user]);

  if (loading) return <div className="panel p-6">Cargando sesión...</div>;
  if (!user || role !== "admin") return null;
  return <>{children}</>;
}
