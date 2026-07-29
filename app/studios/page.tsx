import Link from "next/link";
import { PublicShell } from "@/components/public/PublicShell";
import { listPublishedStudios } from "@/lib/server/public-identity-data";

export const dynamic = "force-dynamic";

export default async function StudiosDirectoryPage() {
  const studios = await listPublishedStudios();

  return (
    <PublicShell brand="ESTUDIOS" navLinks={[{ label: "La Matrix", href: "/matrix" }, { label: "Players", href: "/players" }]}> 
      <section className="relative overflow-hidden border-b border-white/10 px-4 py-16 sm:px-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_10%,rgba(124,58,237,.22),transparent_42%)]" />
        <div className="relative mx-auto max-w-6xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-300/70">La Matrix</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-6xl">Estudios</h1>
          <p className="mt-4 max-w-2xl text-white/60">Estudios, sellos, colectivos y espacios creativos con identidad propia.</p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {studios.length === 0 ? (
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.025] p-8 text-white/50">Todavía no hay Estudios publicados.</div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {studios.map((studio) => (
              <Link
                key={studio.id}
                href={`/studios/${studio.slug}`}
                className="group overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.025] transition duration-300 hover:-translate-y-1 hover:border-violet-400/50"
              >
                <div className="relative h-52 bg-white/[0.03]">
                  {studio.cover_url ? <img src={studio.cover_url} alt={studio.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" /> : <div className="flex h-full items-center justify-center bg-gradient-to-br from-violet-500/25 to-black text-5xl font-semibold text-white/50">{studio.name.charAt(0)}</div>}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#07060b] via-transparent to-transparent" />
                  {studio.logo_url ? <img src={studio.logo_url} alt="" className="absolute bottom-4 left-4 h-16 w-16 rounded-2xl border-2 border-[#07060b] object-cover" /> : null}
                </div>
                <div className="p-5">
                  <h2 className="text-xl font-semibold">{studio.name}</h2>
                  <p className="mt-1 text-xs text-white/40">{[studio.city, studio.country].filter(Boolean).join(", ")}</p>
                  {studio.tagline || studio.description ? <p className="mt-4 line-clamp-2 text-sm leading-6 text-white/60">{studio.tagline || studio.description}</p> : null}
                  {studio.categories?.length ? <div className="mt-5 flex flex-wrap gap-2">{studio.categories.slice(0, 3).map((category) => <span key={category} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/50">{category}</span>)}</div> : null}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </PublicShell>
  );
}
