import Link from "next/link";
import { PublicShell } from "@/components/public/PublicShell";
import { VISUAL_ASSETS } from "@/lib/visual-assets";

export const metadata = {
  title: "La Matrix | CLOUVA",
  description: "Encontrá Players y estudios conectados por la música, la creación y los proyectos.",
};

export default function MatrixPage() {
  return (
    <PublicShell brand="LA MATRIX" brandHref="/matrix">
      <section
        className="relative mx-auto flex min-h-[70vh] max-w-4xl flex-col items-center justify-center overflow-hidden px-4 py-20 text-center sm:py-28"
        data-visual-asset="matrix-network-master-01"
      >
        <div
          className="absolute inset-0 -z-10 bg-cover bg-center"
          style={{ backgroundImage: `url(${VISUAL_ASSETS["matrix-network-master-01"]})` }}
          aria-hidden="true"
        />
        {/* Only for text legibility right where the copy sits -- the artwork stays visible everywhere else, unlike the earlier near-opaque overlay. */}
        <div className="absolute inset-x-0 bottom-0 -z-10 h-2/3 bg-gradient-to-t from-[#07060b] via-[#07060b]/55 to-transparent" aria-hidden="true" />
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">LA MATRIX</h1>
        <p className="mt-5 max-w-xl text-white/60">
          Encontrá Players y estudios conectados por la música, la creación y los proyectos.
        </p>

        <div className="mt-12 grid w-full gap-5 sm:grid-cols-2">
          <Link
            href="/players"
            className="group rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-left transition hover:-translate-y-1 hover:border-[#8f7cff]/50"
          >
            <h2 className="text-xl font-semibold">PLAYERS</h2>
            <p className="mt-2 text-sm text-white/60">Artistas, productores y creadores.</p>
            <span className="mt-6 inline-block rounded-full bg-[#8f7cff] px-4 py-2 text-sm font-medium text-black">
              Explorar Players
            </span>
          </Link>
          <Link
            href="/studios"
            className="group rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-left transition hover:-translate-y-1 hover:border-[#8f7cff]/50"
          >
            <h2 className="text-xl font-semibold">ESTUDIOS</h2>
            <p className="mt-2 text-sm text-white/60">Estudios, sellos, colectivos y espacios creativos.</p>
            <span className="mt-6 inline-block rounded-full border border-white/20 px-4 py-2 text-sm font-medium">
              Explorar Estudios
            </span>
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}
