import Link from "next/link";
import { OfficialClouvaMark } from "@/components/clouva/OfficialClouvaMark";

export function PublicLanding() {
  return (
    <main className="relative min-h-[100svh] overflow-hidden bg-[#010103] text-white">
      <div
        className="absolute inset-0 bg-cover bg-[center_16%] sm:bg-center"
        style={{ backgroundImage: "url('/assets/clouva/welcome-world.svg')" }}
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(1,1,3,.05)_0%,rgba(1,1,3,0)_44%,rgba(1,1,3,.12)_58%,rgba(1,1,3,.76)_82%,#010103_100%)]"
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto flex min-h-[100svh] w-full max-w-[31rem] flex-col px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:max-w-[36rem] sm:px-7">
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-3 text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/80"
            aria-label="CLOUVA"
          >
            <OfficialClouvaMark className="h-10 w-10 drop-shadow-[0_0_14px_rgba(195,133,255,.55)]" />
            <span className="text-[13px] font-semibold uppercase tracking-[0.36em] sm:text-sm">CLOUVA</span>
          </Link>
          <span className="text-[9px] uppercase tracking-[0.38em] text-white/82">vida de flows</span>
        </header>

        <section className="flex flex-1 flex-col items-center justify-end pb-1 pt-[59svh] text-center sm:pt-[60svh]">
          <div className="w-full">
            <h1
              className="select-none uppercase leading-[0.82] text-white drop-shadow-[0_0_28px_rgba(167,78,255,.95)]"
              style={{
                fontFamily: "Anton, Impact, sans-serif",
                fontSize: "clamp(4.5rem, 20.5vw, 7.6rem)",
                fontStyle: "italic",
                letterSpacing: "-0.055em",
                transform: "skewX(-6deg)",
              }}
            >
              CLOUVA
            </h1>
            <p className="mt-4 text-[clamp(0.82rem,3.35vw,1.05rem)] font-light lowercase tracking-[0.54em] text-violet-300/90">
              vida de flows
            </p>
            <p className="mt-5 text-[clamp(0.96rem,4vw,1.15rem)] font-light tracking-[0.015em] text-white/94">
              Entrá a tu universo creativo.
            </p>
          </div>

          <div className="mt-6 grid w-full grid-cols-2 gap-3">
            <Link
              href="/login"
              className="inline-flex min-h-[4.1rem] items-center justify-center gap-3 rounded-full border border-white/90 bg-[linear-gradient(135deg,#fff_0%,#f2e7ff_48%,#d4a8ff_100%)] px-4 text-[clamp(1rem,4.5vw,1.3rem)] font-bold text-violet-950 shadow-[0_0_30px_rgba(151,61,255,.78)] transition duration-300 hover:scale-[1.015] active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200"
            >
              <span className="grid h-11 w-11 place-items-center rounded-full bg-[#12051c] shadow-[0_0_18px_rgba(154,70,255,.7)]" aria-hidden="true">
                <span className="text-[1.45rem] leading-none text-violet-300">♣</span>
              </span>
              Entrar
            </Link>
            <Link
              href="/matrix"
              className="inline-flex min-h-[4.1rem] items-center justify-center gap-4 rounded-full border border-violet-300/85 bg-black/40 px-5 text-[clamp(1rem,4.5vw,1.3rem)] font-bold text-white shadow-[0_0_25px_rgba(115,44,220,.4)] backdrop-blur-md transition duration-300 hover:border-violet-200 hover:bg-violet-500/10 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              Ver <span className="text-2xl font-light text-violet-400" aria-hidden="true">→</span>
            </Link>
          </div>

          <footer className="mt-7 w-full pb-1 text-center">
            <div className="flex items-center justify-center gap-3">
              <span className="h-px w-8 bg-violet-500/35" aria-hidden="true" />
              <p className="text-[8px] uppercase tracking-[0.4em] text-violet-300/80 sm:text-[9px]">
                Directamente desde el southside
              </p>
              <span className="h-px w-8 bg-violet-500/35" aria-hidden="true" />
            </div>
            <p className="mx-auto mt-5 max-w-md text-[9px] leading-relaxed text-white/58 sm:text-[10px]">
              Al entrar o explorar, aceptás los{" "}
              <Link href="/terminos" className="text-violet-300/95 underline-offset-2 hover:underline">Términos</Link>{" "}
              y la{" "}
              <Link href="/privacidad" className="text-violet-300/95 underline-offset-2 hover:underline">Política de Privacidad</Link>.
            </p>
          </footer>
        </section>
      </div>
    </main>
  );
}
