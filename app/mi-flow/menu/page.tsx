"use client";

import Link from "next/link";
import { ModuleCard } from "@/components/os-ui";
import { CloverIcon } from "@/components/clover-icon";

const sections = [
  { title: "Avatar", href: "/mi-flow/avatar" },
  { title: "Flows", href: "/mi-flow/flows" },
  { title: "Studio", href: "/mi-flow/studio" },
  { title: "Vault", href: "/mi-flow/vault" },
  { title: "Launch", href: "/mi-flow/launch" },
  { title: "Visual", href: "/mi-flow/visual" },
  { title: "Store", href: "/mi-flow/store" },
  { title: "Money", href: "/mi-flow/money" },
  { title: "Tasks", href: "/mi-flow/tasks" },
  { title: "Lore", href: "/mi-flow/lore" },
  { title: "Agenda", href: "/mi-flow/agenda" },
];

export default function MenuPage() {
  return (
    <main className="min-h-screen bg-[#050505] px-4 pb-28 pt-8 text-white sm:px-8">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <CloverIcon className="text-[#8f7cff]" size={26} />
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-white/40">Todo Clouva</p>
          <h1 className="font-stencil text-2xl tracking-wide">¿Qué querés hacer?</h1>
        </div>
      </div>

      <div className="mx-auto mt-8 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-3">
        {sections.map((s) => (
          <ModuleCard key={s.href} title={s.title} href={s.href} />
        ))}
        <Link href="/tienda" className="os-card flex min-w-[9.5rem] flex-col gap-3 border-l-2 border-l-[#8f7cff]/50 p-4">
          <p className="font-medium">Tienda</p>
        </Link>
        <Link href="/perfil" className="os-card flex min-w-[9.5rem] flex-col gap-3 border-l-2 border-l-[#8f7cff]/50 p-4">
          <p className="font-medium">Perfil</p>
        </Link>
      </div>

      <nav className="fixed bottom-3 left-1/2 z-20 flex w-[88%] max-w-xs -translate-x-1/2 items-center justify-around rounded-2xl border border-white/10 bg-black/70 p-2 backdrop-blur">
        <Link href="/" className="flex flex-col items-center gap-1 px-6 py-1 text-[10px] text-white/70">
          <span className="text-xl leading-none">🏠</span>
          Home
        </Link>
        <Link href="/mi-flow/menu" className="flex flex-col items-center gap-1 px-6 py-1 text-[10px] text-white">
          <CloverIcon size={20} className="text-[#8f7cff]" />
          Todo
        </Link>
      </nav>
    </main>
  );
}
