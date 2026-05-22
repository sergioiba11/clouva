import Link from "next/link";
import { MainFooter, MainNav } from "@/components/layout";
import { ProductCard, SectionTitle } from "@/components/ui";
import { products } from "@/lib/data";

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden">
      <MainNav />
      <section className="hero-mobile-safe relative isolate flex min-h-[82svh] items-start border-b border-white/10 px-4 pb-8 pt-14 sm:min-h-[80svh] sm:pt-16 md:min-h-[92vh] md:items-end md:px-8 md:pb-14 md:pt-24">
        <div className="absolute inset-0 clouva-grid opacity-20" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_62%_47%,rgba(110,195,255,.20),transparent_22%),radial-gradient(circle_at_56%_58%,rgba(137,90,255,.35),transparent_18%)]" />
        <div className="absolute left-1/2 top-[38%] h-[54vw] w-[54vw] max-h-[300px] max-w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(72,136,255,.30)_0%,rgba(95,64,222,.26)_36%,rgba(35,15,80,.08)_66%,transparent_82%)] blur-3xl animate-[pulse_9s_ease-in-out_infinite] md:top-[50%] md:h-[28rem] md:w-[28rem]" />
        <div className="pointer-events-none absolute left-1/2 top-[42%] hidden -translate-x-1/2 -translate-y-1/2 text-[28vw] font-semibold tracking-[0.35em] text-white/[0.03] md:block md:text-[13rem]">CLOUVA</div>
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(3,3,6,1),rgba(3,3,6,.25))]" />
        <div className="hero-glow-pulse pointer-events-none absolute left-1/2 top-[40%] h-[280px] w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(64,126,255,0.35)_0%,rgba(123,66,255,0.26)_40%,rgba(6,8,14,0)_72%)] blur-3xl md:top-[52%] md:h-[460px] md:w-[460px]" />
        <div className="pointer-events-none absolute left-1/2 top-[42%] hidden -translate-x-1/2 -translate-y-1/2 text-[22vw] font-semibold tracking-[0.38em] text-white/[0.03] sm:block md:top-[50%] md:text-[16vw]">CLOUVA</div>
        <div className="relative mx-auto w-full max-w-7xl">
          <div className="hero-fade-up max-w-xl pt-1 md:pt-0">
            <p className="text-[11px] uppercase tracking-[0.24em] text-[#78c9ff] md:text-xs md:tracking-[0.26em]">Zapala, Southside</p>
            <h1 className="mt-2 text-5xl font-semibold leading-[0.88] tracking-tight sm:text-6xl md:mt-3 md:text-8xl">CLOUVA</h1>
            <p className="mt-4 max-w-md text-sm text-white/75 sm:text-base md:mt-6 md:max-w-lg md:text-lg">Vida de flows. <br />Directamente desde el southside.</p>
            <div className="mt-6 flex flex-wrap gap-3 md:mt-8">
              <Link href="/tienda" className="rounded-full bg-white px-6 py-3 text-xs font-medium uppercase tracking-[0.14em] text-black transition-transform duration-300 hover:-translate-y-0.5 hover:shadow-[0_10px_40px_rgba(255,255,255,0.18)]">Ver Drop 001</Link>
              <Link href="/lookbook" className="rounded-full border border-white/30 px-6 py-3 text-xs uppercase tracking-[0.14em] text-white transition duration-300 hover:border-[#8f7cff] hover:bg-[#8f7cff]/10">Explorar universo</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 py-20 md:px-8">
        <SectionTitle overline="Editorial statement" title="No seguimos tendencias. Construimos lenguaje." subtitle="Texturas oscuras, siluetas techwear y dirección cinematográfica con código de barrio." />
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 pb-20 md:px-8">
        <SectionTitle overline="Featured products" title="Selección Drop 001" />
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {products.slice(0, 6).map((p) => <ProductCard key={p.id} name={p.name} price={p.price} href={`/producto/${p.slug}`} category={p.category} />)}
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-7xl gap-4 px-4 pb-20 sm:grid-cols-2 md:px-8">
        {["Underground frames", "Studio nights", "Southside signals", "Drop ritual"].map((item) => (
          <article key={item} className="aspect-[4/5] rounded-3xl border border-white/10 bg-white/[0.04] p-6">
            <p className="text-sm uppercase tracking-[0.22em] text-white/45">{item}</p>
          </article>
        ))}
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 pb-20 text-center md:px-8">
        <SectionTitle overline="Historia CLOUVA" title="De Zapala al mapa global." subtitle="CLOUVA nace en el frío patagónico y traduce esa crudeza a piezas premium con visión futurista." />
      </section>

      <MainFooter />
      <style jsx>{`
        @keyframes fadeUp {
          from {
            opacity: 0;
            transform: translate3d(0, 16px, 0);
          }
          to {
            opacity: 1;
            transform: translate3d(0, 0, 0);
          }
        }
      `}</style>
    </main>
  );
}
