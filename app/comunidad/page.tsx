import Link from "next/link";
import { MainFooter, MainNav } from "@/components/layout";

export default function ComunidadPage() {
  return (
    <main>
      <MainNav />
      <section className="mx-auto max-w-4xl px-4 py-16 md:px-8">
        <h1 className="text-4xl font-semibold">Comunidad</h1>
        <p className="mt-3 text-white/60">
          Descubrí estudios, sellos, colectivos y a los players que hacen CLOUVA.
        </p>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          <Link href="/comunidad/estudios" className="panel block rounded-3xl p-6 transition hover:-translate-y-1">
            <h2 className="text-xl font-semibold">Estudios</h2>
            <p className="mt-2 text-sm text-white/60">Sellos, colectivos y comunidades creativas.</p>
          </Link>
          <Link href="/comunidad/players" className="panel block rounded-3xl p-6 transition hover:-translate-y-1">
            <h2 className="text-xl font-semibold">Players</h2>
            <p className="mt-2 text-sm text-white/60">Artistas, productores y creadores.</p>
          </Link>
        </div>
      </section>
      <MainFooter />
    </main>
  );
}
