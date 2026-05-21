"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingRole, setCheckingRole] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    const checkRole = async () => {
      if (!user) {
        setCheckingRole(false);
        return;
      }

      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      const role = data?.role as string | undefined;
      setIsAdmin(role === "owner" || role === "admin");
      setCheckingRole(false);
    };

    checkRole();
  }, [user]);

  if (loading || checkingRole) return <div className="p-6 text-sm text-white/70">Cargando dashboard premium...</div>;
  if (!user) return null;
  if (!isAdmin) return <div className="p-6 text-sm text-rose-300">No autorizado para admin.</div>;

  return <>{children}</>;
}
