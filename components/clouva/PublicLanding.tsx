import Link from "next/link";
import { Compass } from "lucide-react";
import { CloverIcon } from "@/components/clover-icon";
import { VISUAL_ASSETS } from "@/lib/visual-assets";

export function PublicLanding() {
  return (
    <main className="relative min-h-[100svh] overflow-hidden bg-[#05040a] text-white">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${VISUAL_ASSETS["public-landing-hero-01"]})` }}
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(118,62,255,0.20),transparent_36%),linear-gradient(to_bottom,rgba(5,4,10,0.20)_0%,rgba(5,4,10,0.52)_52%,#05040a_88%)]"
        aria-hidden="true"
      />
      <div
        className="absolute inset-x-0 top-[16%] mx-auto h-[38rem] w-[38rem] max-w-[92vw] rounded-full bg-violet-600/10 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto flex min-h-[100svh] w-full max-w-6xl flex-col px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8">
        <header className="flex items-center justify-center pt-2 sm:justify-start">
          <Link href="/" className="inline-flex items-center gap-3" aria-label="CLOUVA">
            <span className="grid h-11 w-11 place-items-center rounded-full border border-violet-300/45 bg-black/35 text-violet-300 shadow-[0_0_30px_rgba(139,92,246,0.22)] backdrop-blur-xl">
              <CloverIcon size={23} />
            </span>
            <span className="text-xl font-semibold tracking-[0.24em] text-white sm:text-2xl">CLOUVA</span>
          </Link>
        </header>

        <section className="flex flex-1 flex-col items-center justify-end pb-[8vh] pt-14 text-center sm:justify-center sm:pb-0 sm:pt-10">
          <div className="mb-10 h-44 w-px bg-gradient-to-b from-transparent via-violet-400/60 to-violet-300/10 sm:mb-12 sm:h-52" aria-hidden="true" />

          <div className="relative">
            <div className="absolute -inset-x-12 -inset-y-8 -z-10 rounded-full bg-violet-500/10 blur-3xl" aria-hidden="true" />
            <h1 className="text-[clamp(3.6rem,16vw,8rem)] font-light leading-none tracking-[0.08em] text-white drop-shadow-[0_0_28px_rgba(139,92,246,0.25)]">
              CLOUVA
            </h1>
            <p className="mt-4 text-[clamp(1.05rem,4.5vw,1.5rem)] font-light lowercase tracking-[0.42em] text-violet-200/85">
              vida de flows
            </p>
          </div>

          <div className="mt-12 flex w-full max-w-md flex-col gap-3.5 sm:mt-14">
            <Link
              href="/login"
              className="inline-flex min-h-14 items-center justify-center rounded-full border border-violet-300/35 bg-gradient-to-r from-violet-600 via-violet-500 to-fuchsia-500 px-7 text-base font-semibold text-white shadow-[0_14px_50px_rgba(124,58,237,0.30),inset_0_1px_0_rgba(255,255,255,0.25)] transition duration-300 hover:scale-[1.01] hover:brightness-110 active:scale-[0.99]"
            >
              Ingresar
            </Link>

            <Link
              href="/matrix"
              className="inline-flex min-h-14 items-center justify-center gap-3 rounded-full border border-violet-300/40 bg-black/35 px-7 text-base font-medium text-white/95 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_34px_rgba(124,58,237,0.10)] backdrop-blur-xl transition duration-300 hover:border-violet-300/70 hover:bg-violet-500/10 active:scale-[0.99]"
            >
              <Compass size={18} className="text-violet-300" />
              Explorar La Matrix
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
