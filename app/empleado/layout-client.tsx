"use client";

import { useAuth } from "@/components/auth-provider";
import { canAccessEmployee, roleHome } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function EmpleadoLayoutClient({ children }: { children: React.ReactNode }) {
  const { user, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!canAccessEmployee(role)) {
      router.replace(roleHome[role]);
    }
  }, [loading, role, router, user]);

  if (loading || !user || !canAccessEmployee(role)) return null;

  return children;
}
