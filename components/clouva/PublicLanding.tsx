import Link from "next/link";
import { OfficialClouvaMark } from "@/components/clouva/OfficialClouvaMark";

export function PublicLanding() {
  return (
    <main className="relative min-h-[100svh] overflow-hidden bg-[#020204] text-white">
      <div
        className="absolute inset-0 bg-cover bg-[center_20%] sm:bg-center"
        style={{ backgroundImage: "url('/assets/clouva/welcome-world.svg')" }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,2,4,.06)_0%,rgba(2,2,4,.02)_48%,rgba(2,2,4,.35)_66%,rgba(2,2,4,.88)_88%,#020204_100%)]"
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

        <section className="flex flex-1 flex-col items-center justify-end pb-1 pt-[58svh] text-center sm:pt-[60svh]">
          <div className="w-full">
            <h1
              className="select-none uppercase leading-[0.84] text-white drop-shadow-[0_0_26px_rgba(164,82,255,.75)]"
              style={{
                fontFamily: "Anton, Impact, sans-serif",
                fontSize: "clamp(4.4rem, 20vw, 7.4rem)",
                fontStyle: "italic",
                letterSpacing: "-0.055em",
                transform: "skewX(-6deg)",
              }}
            >
              CLOUVA
            </h1>
            <p className="mt-4 text-[clamp(0.82rem,3.3vw,1.02rem)] font-light lowercase tracking-[0.52em] text-violet-300/85">
              vida de flows
            </p>
            <p className="mt-5 text-[clamp(0.95rem,4vw,1.12rem)] font-light tracking-[0.015em] text-white/92">
              Entrá a tu universo creativo.
            </p>
          </div>

          <div className="mt-6 grid w-full grid-cols-2 gap-3">
            <Link
              href="/login"
              className="inline-flex min-h-16 items-center justify-center rounded-full border border-violet-200/90 bg-[linear-gradient(135deg,#fff_0%,#f0e3ff_50%,#cf9dff_100%)] px-6 text-[clamp(1rem,4.5vw,1.28rem)] font-bold text-violet-950 shadow-[0_0_28px_rgba(138,43,226,.7)] transition duration-300 hover:scale-[1.015] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200"
            >
              Entrar
            </Link>
            <Link
              href="/matrix"
              className="inline-flex min-h-16 items-center justify-center gap-3 rounded-full border border-violet-300/75 bg-black/35 px-6 text-[clamp(1rem,4.5vw,1.28rem)] font-bold text-white shadow-[0_0_22px_rgba(115,44,220,.3)] backdrop-blur-md transition duration-300 hover:border-violet-200 hover:bg-violet-500/10 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              Ver <span className="text-violet-400" aria-hidden="true">→</span>
            </Link>
          </div>

          <footer className="mt-7 w-full pb-1 text-center">
            <p className="text-[8px] uppercase tracking-[0.38em] text-violet-300/75 sm:text-[9px]">
              Directamente desde el southside
            </p>
            <div className="mx-auto mt-3 h-px w-24 bg-gradient-to-r from-transparent via-violet-400/65 to-transparent" aria-hidden="true" />
            <p className="mx-auto mt-3 max-w-md text-[9px] leading-relaxed text-white/50 sm:text-[10px]">
              Al entrar o explorar, aceptás los{" "}
              <Link href="/terminos" className="text-violet-300/90 underline-offset-2 hover:underline">Términos</Link>{" "}
              y la{" "}
              <Link href="/privacidad" className="text-violet-300/90 underline-offset-2 hover:underline">Política de Privacidad</Link>.
            </p>
          </footer>
        </section>
      </div>
    </main>
  );
}
