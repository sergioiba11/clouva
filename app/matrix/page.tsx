import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Globe2,
  Network,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { PublicShell } from "@/components/public/PublicShell";
import { MatrixAdminOverview } from "@/components/matrix/MatrixAdminOverview";
import { listPublishedPlayers, listPublishedStudios } from "@/lib/server/public-identity-data";
import { VISUAL_ASSETS } from "@/lib/visual-assets";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "La Matrix | CLOUVA",
  description: "Encontrá Players y Estudios conectados por la música, la creación y los proyectos.",
};

const matrixNav = [
  { label: "Inicio", href: "/" },
  { label: "Players", href: "/players" },
  { label: "Estudios", href: "/studios" },
  { label: "Sellos", href: "#sellos", disabled: true },
  { label: "Colectivos", href: "#colectivos", disabled: true },
  { label: "Mundos", href: "#mundos", disabled: true },
];

export default async function MatrixPage() {
  const [players, studios] = await Promise.all([
    listPublishedPlayers().catch(() => []),
    listPublishedStudios().catch(() => []),
  ]);

  return (
    <PublicShell brand="LA MATRIX" brandHref="/matrix" navLinks={matrixNav}>
      <section
        className="relative isolate min-h-[calc(100dvh-4rem)] overflow-hidden px-4 py-12 sm:px-6 sm:py-16"
        data-visual-asset="matrix-network-master-01"
      >
        <div
          className="absolute inset-0 -z-30 bg-cover bg-center opacity-75"
          style={{ backgroundImage: `url(${VISUAL_ASSETS["matrix-network-master-01"]})` }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_50%_20%,rgba(119,53,238,.08),transparent_35%),linear-gradient(180deg,rgba(7,6,11,.35),#07060b_82%)]" />
        <div className="absolute inset-0 -z-10 opacity-30 [background-image:linear-gradient(rgba(141,91,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(141,91,255,.12)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(circle_at_center,black,transparent_82%)]" />

        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-500/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-violet-200">
              <Network size={14} />
              Ecosistema creativo CLOUVA
            </span>
            <h1 className="mt-7 text-5xl font-black tracking-[-0.06em] text-white sm:text-7xl lg:text-8xl">
              LA MATRIX
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-white/60 sm:text-base">
              Encontrá Players y Estudios conectados por la música, la creación y los proyectos.
              Cada identidad mantiene su propia voz y se conecta con una red real.
            </p>
          </div>

          <MatrixAdminOverview />

          <div className="mx-auto mt-12 grid max-w-4xl gap-5 md:grid-cols-2">
            <Link
              href="/players"
              className="group relative overflow-hidden rounded-[2rem] border border-violet-400/20 bg-[linear-gradient(145deg,rgba(28,18,58,.9),rgba(8,7,18,.92))] p-7 shadow-[0_24px_80px_rgba(0,0,0,.35)] transition duration-300 hover:-translate-y-1 hover:border-violet-300/50"
            >
              <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-violet-500/15 blur-2xl transition group-hover:bg-violet-500/25" />
              <div className="relative flex items-start justify-between gap-5">
                <span className="grid h-14 w-14 place-items-center rounded-2xl border border-violet-400/30 bg-violet-500/15 text-violet-200 shadow-[0_0_35px_rgba(124,58,237,.2)]">
                  <UsersRound size={27} />
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1 text-[10px] uppercase tracking-wider text-white/45">
                  {players.length ? `${players.length} publicados` : "Directorio"}
                </span>
              </div>
              <h2 className="relative mt-7 text-3xl font-bold tracking-tight">PLAYERS</h2>
              <p className="relative mt-3 max-w-sm text-sm leading-6 text-white/55">
                Artistas, productores y creadores con una identidad pública propia.
              </p>
              <span className="relative mt-8 inline-flex items-center gap-2 rounded-full bg-violet-500 px-5 py-2.5 text-xs font-semibold text-white transition group-hover:bg-violet-400">
                Explorar Players <ArrowRight size={14} />
              </span>
            </Link>

            <Link
              href="/studios"
              className="group relative overflow-hidden rounded-[2rem] border border-white/12 bg-[linear-gradient(145deg,rgba(19,16,38,.9),rgba(8,7,18,.92))] p-7 shadow-[0_24px_80px_rgba(0,0,0,.35)] transition duration-300 hover:-translate-y-1 hover:border-violet-300/45"
            >
              <div className="absolute -bottom-14 -left-10 h-44 w-44 rounded-full bg-violet-500/10 blur-2xl transition group-hover:bg-violet-500/20" />
              <div className="relative flex items-start justify-between gap-5">
                <span className="grid h-14 w-14 place-items-center rounded-2xl border border-violet-400/25 bg-violet-500/10 text-violet-200">
                  <Building2 size={27} />
                </span>
                <span className="rounded-full border border-white/10 px-3 py-1 text-[10px] uppercase tracking-wider text-white/45">
                  {studios.length ? `${studios.length} publicados` : "Directorio"}
                </span>
              </div>
              <h2 className="relative mt-7 text-3xl font-bold tracking-tight">ESTUDIOS</h2>
              <p className="relative mt-3 max-w-sm text-sm leading-6 text-white/55">
                Estudios, sellos, colectivos y espacios creativos con identidad propia.
              </p>
              <span className="relative mt-8 inline-flex items-center gap-2 rounded-full border border-violet-300/30 bg-violet-500/10 px-5 py-2.5 text-xs font-semibold text-violet-100 transition group-hover:bg-violet-500/20">
                Explorar Estudios <ArrowRight size={14} />
              </span>
            </Link>
          </div>

          <section className="mx-auto mt-8 grid max-w-4xl gap-3 sm:grid-cols-3" aria-label="Próximas áreas de La Matrix">
            {[
              { title: "Sellos", icon: Sparkles },
              { title: "Colectivos", icon: Globe2 },
              { title: "Mundos", icon: Network },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="flex cursor-not-allowed items-center gap-3 rounded-2xl border border-white/[0.06] bg-zinc-900/55 p-4 text-white/30 grayscale">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.04]"><Icon size={17} /></span>
                  <div>
                    <h3 className="text-sm font-semibold">{item.title}</h3>
                    <p className="mt-0.5 text-[10px] uppercase tracking-wider">Próximamente</p>
                  </div>
                </article>
              );
            })}
          </section>

          <div className="mx-auto mt-10 grid max-w-4xl gap-4 border-t border-white/10 pt-7 text-xs text-white/45 sm:grid-cols-3">
            <p className="flex items-center gap-2"><CheckCircle2 size={15} className="text-violet-300" /> Perfiles públicos independientes</p>
            <p className="flex items-center gap-2"><CheckCircle2 size={15} className="text-violet-300" /> Conexiones reales con Estudios</p>
            <p className="flex items-center gap-2"><CheckCircle2 size={15} className="text-violet-300" /> Contenido y proyectos visibles</p>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
