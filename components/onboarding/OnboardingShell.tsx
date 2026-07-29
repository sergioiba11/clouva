import Link from "next/link";
import type { ReactNode } from "react";

export function OnboardingShell({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#05040a] px-4 py-6 text-white sm:py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(124,58,237,.28),transparent_38%)]" />
      <div className="relative mx-auto w-full max-w-xl">
        <header className="flex items-center justify-between">
          <Link href="/matrix" className="text-lg font-bold tracking-[0.14em]">CLOUVA</Link>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/50">Paso {step} de 5</span>
        </header>

        <div className="mt-5 h-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500" style={{ width: `${Math.min(100, Math.max(0, step * 20))}%` }} />
        </div>

        <section className="mt-7 rounded-[2rem] border border-white/10 bg-[#0b0913]/90 p-5 shadow-2xl shadow-violet-950/20 backdrop-blur-xl sm:p-8">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          {description ? <p className="mt-3 leading-7 text-white/55">{description}</p> : null}
          <div className="mt-7">{children}</div>
        </section>
      </div>
    </main>
  );
}
