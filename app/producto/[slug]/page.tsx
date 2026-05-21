import Link from "next/link";
import { MainFooter, MainNav } from "@/components/layout";

export default async function ProductDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <main>
      <MainNav />
      <section className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 md:grid-cols-2 md:px-8">
        <div className="aspect-square rounded-3xl border border-white/10 bg-white/[0.04]" />
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[#74c5ff]">Drop 001</p>
          <h1 className="mt-3 text-4xl font-semibold">{slug.replaceAll('-', ' ')}</h1>
          <p className="mt-4 max-w-md text-white/70">Corte técnico premium, fit relajado y texturas pensadas para streetwear de alto nivel.</p>
          <p className="mt-6 text-2xl text-[#95d8ff]">$129.900</p>
          <div className="mt-8 flex gap-3">
            <button className="rounded-full bg-white px-6 py-3 text-sm font-medium text-black">Agregar al carrito</button>
            <Link className="rounded-full border border-white/30 px-6 py-3 text-sm" href="/carrito">Ir al carrito</Link>
          </div>
        </div>
      </section>
      <MainFooter />
    </main>
  );
}
