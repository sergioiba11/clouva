import type { Metadata } from "next";
import Link from "next/link";
import { MainFooter, MainNav } from "@/components/layout";

export const metadata: Metadata = {
  title: "Qué es CLOUVA — Plataforma creativa",
  description: "CLOUVA es una plataforma creativa que conecta música, identidad, moda, 3D, creación, espacios, comercio e inteligencia artificial.",
  alternates: { canonical: "https://clouva.com.ar/sobre-clouva" },
  robots: { index: true, follow: true },
  openGraph: {
    type: "website",
    siteName: "CLOUVA",
    locale: "es_AR",
    url: "https://clouva.com.ar/sobre-clouva",
    title: "Qué es CLOUVA — Plataforma creativa",
    description: "Un universo creativo que conecta música, identidad, moda, 3D, creación, espacios, comercio e inteligencia artificial.",
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  "@id": "https://clouva.com.ar/sobre-clouva#page",
  url: "https://clouva.com.ar/sobre-clouva",
  name: "Qué es CLOUVA — Plataforma creativa",
  inLanguage: "es-AR",
  isPartOf: { "@id": "https://clouva.com.ar/#website" },
  about: { "@id": "https://clouva.com.ar/#platform" },
};

export default function SobreClouvaPage() {
  return (
    <main className="min-h-screen bg-[#07070a] text-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
      <MainNav />
      <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-violet-300/75">CLOUVA</p>
        <h1 className="mt-4 max-w-4xl text-5xl font-black tracking-[-0.055em] sm:text-7xl">Un universo creativo conectado.</h1>
        <p className="mt-6 max-w-3xl text-base leading-8 text-white/65 sm:text-lg">
          CLOUVA es una plataforma creativa que reúne identidad, música, moda, creación 3D, Creator, Market, espacios y herramientas de inteligencia artificial dentro de una misma arquitectura.
        </p>
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {[
            ["Identidad y Players", "Perfiles públicos, presencia artística, conexiones, contenido y una identidad propia dentro de La Matrix."],
            ["Música y estudios", "Artistas, productores, estudios, sesiones, radio, reservas y conexiones entre personas y espacios creativos."],
            ["Creator y 3D", "Herramientas para crear, visualizar, analizar y convertir ideas, prendas, avatares, estructuras y contenido."],
            ["Market y espacios", "Productos, comercio, Mi Spot y experiencias conectadas a la identidad y al mundo físico."],
          ].map(([title, text]) => (
            <article key={title} className="rounded-[2rem] border border-white/10 bg-white/[0.025] p-6">
              <h2 className="text-xl font-semibold">{title}</h2>
              <p className="mt-3 text-sm leading-6 text-white/55">{text}</p>
            </article>
          ))}
        </div>
        <div className="mt-12 rounded-[2rem] border border-violet-400/20 bg-violet-500/[0.08] p-6 sm:p-8">
          <h2 className="text-2xl font-semibold">CLOUVA y Clouva tienen identidades públicas diferenciadas.</h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-white/60">
            Esta página describe la plataforma CLOUVA. Clouva, el artista, tiene su propia página oficial con música, videos, historia y enlaces a sus perfiles oficiales.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/" className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black">Entrar a CLOUVA</Link>
            <Link href="/clouva" className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold">Ver Clouva — artista</Link>
          </div>
        </div>
      </section>
      <MainFooter />
    </main>
  );
}
