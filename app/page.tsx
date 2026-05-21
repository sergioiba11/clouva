import Link from "next/link";
import { MainFooter, MainNav } from "@/components/layout";
import { ProductCard, SectionTitle } from "@/components/ui";
import { products } from "@/lib/data";

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden">
      <MainNav />
      <section className="relative isolate flex min-h-[90vh] items-end border-b border-white/10 px-4 pb-14 pt-24 md:px-8">
        <div className="absolute inset-0 clouva-grid opacity-20" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_62%_47%,rgba(110,195,255,.20),transparent_22%),radial-gradient(circle_at_56%_58%,rgba(137,90,255,.35),transparent_18%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(3,3,6,1),rgba(3,3,6,.25))]" />
        <div className="relative mx-auto w-full max-w-7xl">
          <p className="text-xs uppercase tracking-[0.26em] text-[#78c9ff]">Zapala, Southside</p>
          <h1 className="mt-2 text-6xl font-semibold leading-[0.9] tracking-tight md:text-8xl">CLOUVA</h1>
          <p className="mt-6 max-w-lg text-base text-white/75 md:text-lg">Vida de flows. <br />Directamente desde el southside.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/tienda" className="rounded-full bg-white px-6 py-3 text-xs font-medium uppercase tracking-[0.14em] text-black">Ver Drop 001</Link>
            <Link href="/lookbook" className="rounded-full border border-white/30 px-6 py-3 text-xs uppercase tracking-[0.14em] text-white">Explorar universo</Link>
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
    </main>
  );
}
