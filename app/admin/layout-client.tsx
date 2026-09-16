"use client";

import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { AssetImportProvider } from "@/components/admin/assets/AssetImportProvider";
import { useAuth } from "@/components/auth-provider";
import { canAccessAdmin, roleHome } from "@/lib/auth";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  const { user, session, role, loading, profile, hydrationReady, profileReady } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || !hydrationReady || !profileReady) return;
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
  }, [loading, user, role, profile, router, pathname, hydrationReady, profileReady, session]);

  if (loading || !hydrationReady || !profileReady) {
    return <main className="mx-auto grid min-h-[70vh] max-w-[1900px] place-items-center p-6 text-sm text-white/45">Cargando CLOUVA Admin...</main>;
  }

  if (!user || !canAccessAdmin(role)) return null;

  return (
    <AssetImportProvider>
      <main className="relative min-h-screen bg-[#050507] text-white">
        <div
          className="pointer-events-none fixed inset-0 opacity-40"
          aria-hidden="true"
          style={{
            backgroundImage:
              "linear-gradient(rgba(139,92,246,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,.035) 1px, transparent 1px), radial-gradient(circle at 72% 4%, rgba(124,58,237,.12), transparent 31%)",
            backgroundSize: "38px 38px, 38px 38px, auto",
          }}
        />
        <div className="relative mx-auto grid w-full max-w-[1900px] gap-4 p-3 md:grid-cols-[232px_minmax(0,1fr)] md:p-4 xl:gap-5 xl:px-5">
          <AdminSidebar />
          <section className="min-w-0 pb-12">{children}</section>
        </div>
      </main>
    </AssetImportProvider>
  );
}
