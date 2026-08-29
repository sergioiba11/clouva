import Link from "next/link";
import { OfficialClouvaMark } from "@/components/clouva/OfficialClouvaMark";

export function PublicLanding() {
  return (
    <main className="relative min-h-[100svh] overflow-hidden bg-[#050507] text-white">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(124,58,237,0.11),transparent_30%),radial-gradient(circle_at_50%_78%,rgba(255,255,255,0.035),transparent_22%)]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:54px_54px] [mask-image:linear-gradient(to_bottom,transparent,black_28%,black_72%,transparent)]"
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto flex min-h-[100svh] w-full max-w-7xl flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8 lg:px-12">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.34em] text-white/88 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/80"
            aria-label="CLOUVA"
          >
            <OfficialClouvaMark className="h-6 w-6" />
            <span>CLOUVA</span>
          </Link>
          <span className="text-[9px] uppercase tracking-[0.26em] text-white/28">vida de flows</span>
        </header>

        <section className="flex flex-1 flex-col items-center justify-center py-8 text-center sm:py-10">
          <div className="relative grid w-full max-w-[24rem] place-items-center">
            <div className="pointer-events-none absolute inset-[19%] rounded-full bg-violet-500/[0.08] blur-3xl" aria-hidden="true" />
            <OfficialClouvaMark className="relative aspect-square w-[72%] max-w-[17rem]" />
          </div>

          <div className="-mt-2 sm:-mt-4">
            <h1 className="text-[clamp(3rem,13vw,7.7rem)] font-light leading-none tracking-[0.13em] text-white">
              CLOUVA
            </h1>
            <p className="mt-4 text-[clamp(0.82rem,3.2vw,1.05rem)] font-light lowercase tracking-[0.46em] text-white/42">
              vida de flows
            </p>
          </div>

          <div className="mt-10 grid w-full max-w-sm grid-cols-2 gap-2.5 sm:mt-12">
            <Link
              href="/login"
              className="inline-flex min-h-14 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-black transition duration-300 hover:bg-white/88 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/80"
            >
              Entrar
            </Link>
            <Link
              href="/matrix"
              className="inline-flex min-h-14 items-center justify-center rounded-full border border-white/16 bg-white/[0.025] px-6 text-sm font-medium text-white transition duration-300 hover:border-white/32 hover:bg-white/[0.06] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/80"
            >
              Ver
            </Link>
          </div>
        </section>

        <footer className="flex items-end justify-between gap-5 pb-1 text-[9px] uppercase tracking-[0.22em] text-white/24">
          <span>Directamente desde el southside</span>
          <span aria-hidden="true">∞</span>
        </footer>
      </div>
    </main>
  );
}
