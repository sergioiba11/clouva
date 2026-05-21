import Link from "next/link";
import { ProShell } from "@/components/pro-shell";
import { SectionBlock } from "@/components/section-block";

export default function Home() {
  return (
    <ProShell>
      <section className="relative isolate flex min-h-[88vh] items-end overflow-hidden border-b border-white/10 px-4 pb-12 pt-24 md:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(124,89,255,.35),transparent_25%),radial-gradient(circle_at_48%_42%,rgba(110,206,255,.25),transparent_20%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(4,4,8,1),rgba(4,4,8,.1))]" />
        <div className="relative mx-auto w-full max-w-7xl">
          <p className="text-xs uppercase tracking-[0.24em] text-[#79ceff]">Cyber / Y2K Underground</p>
          <h1 className="mt-2 text-6xl font-semibold tracking-tight md:text-8xl">CLOUVA</h1>
          <p className="mt-6 max-w-xl text-white/75">Vida de flows. Desde el southside hacia una estética premium futurista.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/productos" className="rounded-full bg-white px-6 py-3 text-xs uppercase tracking-[0.14em] text-black">Ver productos</Link>
            <Link href="/universo" className="rounded-full border border-white/30 px-6 py-3 text-xs uppercase tracking-[0.14em]">Explorar universo</Link>
          </div>
        </div>
      </section>

      <SectionBlock eyebrow="Base Pro" title="Arquitectura lista para Supabase" description="Estructura preparada para productos, usuarios, favoritos, drops y panel admin, sin romper deploy en Vercel." />
    </ProShell>
  );
}
