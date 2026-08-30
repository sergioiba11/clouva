import Link from "next/link";
import { OfficialClouvaMark } from "@/components/clouva/OfficialClouvaMark";

export function PublicLanding() {
  return (
    <main className="relative min-h-[100svh] overflow-hidden bg-[#020204] text-white">
      <div
        className="absolute inset-0 bg-cover bg-[center_18%] sm:bg-center"
        style={{ backgroundImage: "url('/assets/clouva/welcome-world.svg')" }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,2,4,.12)_0%,rgba(2,2,4,.04)_44%,rgba(2,2,4,.58)_68%,#020204_100%)]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[44%] bg-[radial-gradient(circle_at_50%_0%,rgba(126,45,255,.15),transparent_50%)]"
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto flex min-h-[100svh] w-full max-w-[31rem] flex-col px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:max-w-[36rem] sm:px-7">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-3 text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/80"
            aria-label="CLOUVA"
          >
            <OfficialClouvaMark className="h-9 w-9 drop-shadow-[0_0_14px_rgba(174,105,255,.45)]" />
            <span className="text-[13px] font-semibold uppercase tracking-[0.35em] sm:text-sm">CLOUVA</span>
          </Link>
          <span className="text-[9px] uppercase tracking-[0.34em] text-white/70">vida de flows</span>
        </header>

        <section className="relative flex flex-1 flex-col items-center justify-end pb-2 pt-[24svh] text-center sm:pt-[26svh]">
          <div className="pointer-events-none absolute left-0 top-[18svh] hidden -translate-x-1/3 rotate-[-1deg] sm:block" aria-hidden="true">
            <div className="rounded-md border border-violet-400/25 bg-black/20 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-violet-300/80 shadow-[0_0_22px_rgba(139,61,255,.2)] backdrop-blur-sm">Bienvenido</div>
          </div>

          <Link
            href="/studios/iglu"
            className="absolute right-0 top-[18svh] hidden translate-x-1/3 rounded-md border border-violet-400/25 bg-black/20 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-violet-300/80 shadow-[0_0_22px_rgba(139,61,255,.2)] backdrop-blur-sm transition hover:border-violet-300/50 hover:text-violet-200 sm:block"
          >
            El Iglú
          </Link>

          <div className="relative mb-[clamp(1rem,4svh,2.5rem)] grid place-items-center">
            <div className="absolute h-36 w-36 rounded-full bg-violet-500/15 blur-3xl" aria-hidden="true" />
            <OfficialClouvaMark className="relative h-[clamp(6rem,22vw,8.8rem)] w-[clamp(6rem,22vw,8.8rem)] drop-shadow-[0_0_26px_rgba(184,111,255,.95)]" />
          </div>

          <div className="w-full">
            <h1 className="select-none text-[clamp(4.2rem,18vw,7rem)] font-black italic leading-[0.82] tracking-[-0.07em] text-white drop-shadow-[0_0_25px_rgba(155,72,255,.72)]">
              CLOUVA
            </h1>
            <p className="mt-5 text-[clamp(0.85rem,3.4vw,1.05rem)] font-light lowercase tracking-[0.54em] text-violet-300/80">
              vida de flows
            </p>
            <p className="mt-6 text-[clamp(0.95rem,4vw,1.15rem)] font-light tracking-[0.02em] text-white/90">
              Entrá a tu universo creativo.
            </p>
          </div>

          <div className="mt-7 grid w-full grid-cols-2 gap-3">
            <Link
              href="/login"
              className="inline-flex min-h-16 items-center justify-center rounded-full border border-violet-200/85 bg-[linear-gradient(135deg,#fff_0%,#f1e5ff_48%,#d3a6ff_100%)] px-6 text-[clamp(1rem,4.5vw,1.28rem)] font-bold text-violet-950 shadow-[0_0_26px_rgba(138,43,226,.65)] transition duration-300 hover:scale-[1.015] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200"
            >
              Entrar
            </Link>
            <Link
              href="/matrix"
              className="inline-flex min-h-16 items-center justify-center gap-3 rounded-full border border-violet-300/70 bg-black/30 px-6 text-[clamp(1rem,4.5vw,1.28rem)] font-bold text-white shadow-[0_0_20px_rgba(115,44,220,.24)] backdrop-blur-md transition duration-300 hover:border-violet-200 hover:bg-violet-500/10 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              Ver <span className="text-violet-400" aria-hidden="true">→</span>
            </Link>
          </div>

          <footer className="mt-8 w-full pb-1 text-center">
            <p className="text-[8px] uppercase tracking-[0.38em] text-violet-300/70 sm:text-[9px]">
              Directamente desde el southside
            </p>
            <div className="mx-auto mt-4 h-px w-24 bg-gradient-to-r from-transparent via-violet-400/65 to-transparent" aria-hidden="true" />
            <p className="mx-auto mt-4 max-w-md text-[9px] leading-relaxed text-white/45 sm:text-[10px]">
              Al entrar o explorar, aceptás los{" "}
              <Link href="/terminos" className="text-violet-300/85 underline-offset-2 hover:underline">Términos</Link>{" "}
              y la{" "}
              <Link href="/privacidad" className="text-violet-300/85 underline-offset-2 hover:underline">Política de Privacidad</Link>.
            </p>
          </footer>
        </section>
      </div>
    </main>
  );
}
