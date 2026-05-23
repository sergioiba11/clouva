"use client";

import { MainNav } from "@/components/layout";
import { Sidebar } from "@/components/os-ui";
import { useAuth } from "@/components/auth-provider";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const links = ["/mi-flow", "/mi-flow/flows", "/mi-flow/studio", "/mi-flow/vault", "/mi-flow/launch", "/mi-flow/visual", "/mi-flow/store", "/mi-flow/money", "/mi-flow/tasks", "/mi-flow/assistant", "/mi-flow/lore"];

export default function FlowLayoutClient({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading) return <main><MainNav /><div className="mx-auto max-w-7xl p-6">Cargando sesión...</div></main>;
  if (!user) return null;

  return <main className="pb-20 md:pb-0"><MainNav /><div className="mx-auto grid max-w-7xl gap-4 p-4 md:grid-cols-[240px_1fr] md:p-6"><Sidebar links={links} /><section>{children}</section></div><nav className="fixed bottom-3 left-1/2 z-20 flex w-[95%] -translate-x-1/2 gap-2 overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--card)]/90 p-2 backdrop-blur md:hidden">{links.slice(0, 6).map((l) => <Link key={l} href={l} className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs ${pathname === l ? "bg-[var(--chip)]" : "bg-transparent"}`}>{l.split("/").pop()}</Link>)}</nav></main>;
}
