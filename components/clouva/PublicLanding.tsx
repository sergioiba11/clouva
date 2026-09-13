"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClouvaUniverseBackground } from "@/components/clouva/ClouvaUniverseBackground";
import { OfficialClouvaMark } from "@/components/clouva/OfficialClouvaMark";

export function PublicLanding() {
  const router = useRouter();
  const [entering, setEntering] = useState(false);
  const transitionTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
    };
  }, []);

  const enterClouva = () => {
    if (entering) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      router.push("/login");
      return;
    }

    setEntering(true);
    transitionTimerRef.current = window.setTimeout(() => router.push("/login"), 440);
  };

  return (
    <main className="relative min-h-[100svh] overflow-hidden bg-black text-white" aria-busy={entering}>
      <ClouvaUniverseBackground entering={entering} />

      <div
        className={`relative z-10 mx-auto flex min-h-[100svh] w-full max-w-[430px] flex-col px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] transition-[opacity,transform,filter] duration-500 ease-out motion-reduce:transition-none ${
          entering ? "scale-[1.01] opacity-30 blur-[1px]" : "scale-100 opacity-100 blur-0"
        }`}
      >
        <header className="flex items-center justify-between pt-1">
          <Link href="/" className="flex items-center gap-3" aria-label="CLOUVA">
            <span className="grid h-9 w-9 shrink-0 place-items-center">
              <OfficialClouvaMark className="h-9 w-9 scale-[1.6] drop-shadow-[0_0_16px_rgba(190,120,255,.8)]" />
            </span>
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

          <div className="relative mt-6 grid w-full grid-cols-2 gap-3">
            <button
              type="button"
              onClick={enterClouva}
              disabled={entering}
              className="inline-flex min-h-16 items-center justify-center gap-3 rounded-full border border-white/90 bg-[linear-gradient(135deg,#fff_0%,#efe2ff_48%,#d19cff_100%)] px-5 text-[clamp(1.05rem,4.8vw,1.3rem)] font-bold text-violet-950 shadow-[0_0_34px_rgba(170,75,255,.8)] transition hover:brightness-105 active:scale-[.985] disabled:cursor-wait disabled:opacity-85"
            >
              <span className="grid h-10 w-10 place-items-center">
                <OfficialClouvaMark tone="dark" className="h-7 w-7 scale-[1.65] drop-shadow-[0_0_10px_rgba(95,35,145,.25)]" />
              </span>
              {entering ? "Entrando" : "Entrar"}
            </button>

            <Link
              href="/matrix"
              className="inline-flex min-h-16 items-center justify-center gap-4 rounded-full border border-violet-300/90 bg-black/55 px-5 text-[clamp(1.05rem,4.8vw,1.3rem)] font-bold text-white shadow-[0_0_24px_rgba(133,58,255,.42)] backdrop-blur-sm transition hover:border-violet-200 active:scale-[.985]"
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

      <div
        className={`pointer-events-none absolute inset-0 z-20 bg-[radial-gradient(circle_at_50%_42%,rgba(151,76,255,.12),rgba(5,1,12,.38)_38%,rgba(0,0,0,.72)_100%)] transition-opacity duration-500 motion-reduce:hidden ${
          entering ? "opacity-100" : "opacity-0"
        }`}
        aria-hidden="true"
      />
    </main>
  );
}
