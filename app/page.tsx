import { MainNav } from "@/components/layout";
import { products } from "@/lib/data";
import Link from "next/link";

export default function Home(){
  const featured = products.filter(p=>p.featured);
  return <main><MainNav/>
    <section className="grid-premium mx-auto max-w-7xl p-6">
      <div className="panel neon overflow-hidden p-8 md:p-12">
        <p className="text-xs uppercase tracking-[.3em] text-violet-300">VIDA DE FLOWS • LIVE DIFFERENT</p>
        <h1 className="mt-4 text-4xl font-bold leading-tight md:text-6xl">SISTEMA OPERATIVO HUMANO</h1>
        <p className="mt-4 max-w-2xl text-white/75 light:text-black/70">CLOUVA une streetwear premium, ecommerce de alto nivel y un ecosistema inteligente para crear, vender y escalar.</p>
        <div className="mt-6 flex flex-wrap gap-3"><Link href="/tienda" className="rounded-xl bg-violet-600 px-5 py-3 font-medium">Entrar a la tienda</Link><Link href="/mi-flow" className="panel px-5 py-3">Mi Flow</Link></div>
        <p className="mt-8 text-xs uppercase tracking-[.25em] text-cyan-300">NADA ES SUERTE, TODO ES ELECCIÓN • SOUTHSIDE PATAGONIA</p>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-3">{featured.map((p)=><Link key={p.id} href={`/producto/${p.slug}`} className="panel group p-4 transition hover:-translate-y-1"><p className="text-xs text-violet-300">{p.drop || "Featured"}</p><h3 className="mt-1 text-xl">{p.name}</h3><p className="text-white/70 light:text-black/70">${p.price}</p><p className="mt-4 text-xs uppercase tracking-wider opacity-0 transition group-hover:opacity-100">Quick view →</p></Link>)}</div>
    </section>
  </main>
}
