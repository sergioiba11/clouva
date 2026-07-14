"use client";

import { MainNav } from "@/components/layout";
import { Sidebar } from "@/components/os-ui";
import { CloverIcon } from "@/components/clover-icon";
import { useAuth } from "@/components/auth-provider";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const links = ["/mi-flow", "/mi-flow/agenda", "/mi-flow/flows", "/mi-flow/studio", "/mi-flow/vault", "/mi-flow/launch", "/mi-flow/visual", "/mi-flow/store", "/mi-flow/money", "/mi-flow/tasks", "/mi-flow/assistant", "/mi-flow/lore"];

export default function FlowLayoutClient({ children }: { children: React.ReactNode }) {
  const { user, loading, hydrationReady } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || !hydrationReady) return;
    if (!user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !hydrationReady) return <main><MainNav /><div className="mx-auto max-w-7xl p-6">Cargando sesión...</div></main>;
  if (!user) return null;
  const fullScreenPages = [
    "/mi-flow/avatar",
    "/mi-flow/menu",
    "/mi-flow/avatar-ia",
    "/mi-flow/avatar-customizer",
    "/mi-flow/crear-prenda",
    "/mi-flow/armario",
  ];
  if (fullScreenPages.includes(pathname)) return <>{children}</>;

  return (
    <main className="pb-24 md:pb-0">
      <MainNav />
      <div className="mx-auto grid max-w-7xl gap-4 p-4 md:grid-cols-[240px_1fr] md:p-6">
        <Sidebar links={links} />
        <section>{children}</section>
      </div>
      <nav className="fixed bottom-3 left-1/2 z-20 flex w-[88%] max-w-xs -translate-x-1/2 items-center justify-around rounded-2xl border border-[var(--line)] bg-[var(--card)]/90 p-2 backdrop-blur md:hidden">
        <Link href="/" className="flex flex-col items-center gap-1 px-6 py-1 text-[10px] text-white/70">
          <span className="text-xl leading-none">🏠</span>
          Home
        </Link>
        <Link href="/mi-flow/menu" className="flex flex-col items-center gap-1 px-6 py-1 text-[10px] text-white/70">
          <CloverIcon size={20} />
          Todo
        </Link>
      </nav>
    </main>
  );
}
