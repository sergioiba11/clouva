"use client";

import { MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const links = ["/mi-flow","/mi-flow/flows","/mi-flow/studio","/mi-flow/vault","/mi-flow/launch","/mi-flow/visual","/mi-flow/store","/mi-flow/money","/mi-flow/tasks","/mi-flow/assistant","/mi-flow/lore"];

export default function FlowLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [loading, router, user]);
  if (loading) return <main><MainNav /><div className="mx-auto max-w-7xl p-6 text-sm text-white/70">Cargando sesión...</div></main>;
  if (!user) return null;

  return <main className="pb-20 md:pb-0"><MainNav /><div className="mx-auto grid max-w-7xl gap-4 p-4 md:p-6 md:grid-cols-[240px_1fr]"><aside className="panel neon hidden p-3 md:block">{links.map((l)=><Link key={l} href={l} className={`block rounded-lg px-2 py-1 text-sm ${pathname===l?"bg-[#8f7cff]/20":""}`}>{l.replace('/mi-flow/','').toUpperCase()||'HOME'}</Link>)}</aside><section>{children}</section></div><nav className="fixed bottom-3 left-1/2 z-20 flex w-[95%] -translate-x-1/2 gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-black/70 p-2 backdrop-blur md:hidden">{links.slice(0,6).map((l)=><Link key={l} href={l} className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs ${pathname===l?"bg-[#8f7cff]/25":"bg-white/5"}`}>{l.split('/').pop()||'home'}</Link>)}</nav></main>;
}
