import Link from "next/link";
import { OfficialClouvaMark } from "@/components/clouva/OfficialClouvaMark";

export function PublicLanding() {
  return (
    <main className="relative min-h-[100svh] overflow-hidden bg-black text-white">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url('/assets/clouva/landing-bg.jpg')" }}
        aria-hidden="true"
      />

      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,.18)_0%,rgba(0,0,0,.03)_48%,rgba(0,0,0,.12)_58%,rgba(0,0,0,.58)_76%,rgba(0,0,0,.94)_100%)]"
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto flex min-h-[100svh] w-full max-w-[430px] flex-col px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
        <header className="flex items-center justify-between pt-1">
          <Link href="/" className="flex items-center gap-3" aria-label="CLOUVA">
            <OfficialClouvaMark className="h-9 w-9 drop-shadow-[0_0_16px_rgba(190,120,255,.8)]" />
            <span className="text-[13px] font-semibold uppercase tracking-[0.34em]">CLOUVA</span>
          </Link>

          <span className="text-[9px] uppercase tracking-[0.34em] text-white/90">VIDA DE FLOWS</span>
        </header>

        <section className="mt-auto flex flex-col items-center pb-2 text-center">
          <h1
            className="select-none uppercase leading-[0.82] text-white drop-shadow-[0_0_24px_rgba(182,87,255,.95)]"
            style={{
              fontFamily: "Anton, Impact, sans-serif",
              fontSize: "clamp(4.6rem, 21vw, 6.8rem)",
              fontStyle: "italic",
              letterSpacing: "-0.06em",
              transform: "skewX(-7deg)",
            }}
          >
            CLOUVA
          </h1>

          <p className="mt-4 text-[clamp(.9rem,4vw,1.08rem)] font-light lowercase tracking-[0.48em] text-violet-300">
            vida de flows
          </p>

          <p className="mt-5 text-[clamp(1rem,4.3vw,1.15rem)] font-light text-white/95">
            Entrá a tu universo creativo.
          </p>

          <div className="mt-6 grid w-full grid-cols-2 gap-3">
            <Link
              href="/login"
              className="inline-flex min-h-16 items-center justify-center gap-3 rounded-full border border-white/90 bg-[linear-gradient(135deg,#fff_0%,#efe2ff_48%,#d19cff_100%)] px-5 text-[clamp(1.05rem,4.8vw,1.3rem)] font-bold text-violet-950 shadow-[0_0_34px_rgba(170,75,255,.8)] transition active:scale-[.985]"
            >
              <span className="grid h-10 w-10 place-items-center rounded-full bg-[#160720] shadow-[0_0_18px_rgba(174,84,255,.8)]">
                <OfficialClouvaMark className="h-6 w-6 text-violet-200" />
              </span>
              Entrar
            </Link>

            <Link
              href="/matrix"
              className="inline-flex min-h-16 items-center justify-center gap-4 rounded-full border border-violet-300/90 bg-black/55 px-5 text-[clamp(1.05rem,4.8vw,1.3rem)] font-bold text-white shadow-[0_0_24px_rgba(133,58,255,.42)] backdrop-blur-sm transition active:scale-[.985]"
            >
              Ver <span className="text-2xl font-normal text-violet-400">→</span>
            </Link>
          </div>

          <footer className="mt-7 w-full text-center">
            <div className="flex items-center justify-center gap-3">
              <span className="h-px w-9 bg-violet-400/55" />
              <p className="text-[8px] uppercase tracking-[0.36em] text-violet-300/90 sm:text-[9px]">
                Directamente desde el southside
              </p>
              <span className="h-px w-9 bg-violet-400/55" />
            </div>

            <p className="mx-auto mt-5 max-w-[360px] text-[9px] leading-relaxed text-white/65 sm:text-[10px]">
              Al entrar o explorar, aceptás los{" "}
              <Link href="/terminos" className="text-violet-300">Términos</Link>{" "}
              y la{" "}
              <Link href="/privacidad" className="text-violet-300">Política de Privacidad</Link>.
            </p>
          </footer>
        </section>
      </div>
    </main>
  );
}
