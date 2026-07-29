import Link from "next/link";
import { PublicShell } from "@/components/public/PublicShell";
import { listPublishedPlayers } from "@/lib/server/public-identity-data";

export const dynamic = "force-dynamic";

export default async function PlayersDirectoryPage() {
  const players = await listPublishedPlayers();

  return (
    <PublicShell brand="PLAYERS" navLinks={[{ label: "La Matrix", href: "/matrix" }, { label: "Estudios", href: "/studios" }]}> 
      <section className="relative overflow-hidden border-b border-white/10 px-4 py-16 sm:px-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_10%,rgba(124,58,237,.22),transparent_42%)]" />
        <div className="relative mx-auto max-w-6xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-300/70">La Matrix</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-6xl">Players</h1>
          <p className="mt-4 max-w-2xl text-white/60">Artistas, productores y creadores con una identidad pública propia dentro de CLOUVA.</p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {players.length === 0 ? (
          <div className="rounded-[2rem] border border-white/10 bg-white/[0.025] p-8 text-white/50">Todavía no hay Players publicados.</div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {players.map((player) => (
              <Link
                key={player.id}
                href={`/${player.slug}`}
                className="group overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.025] transition duration-300 hover:-translate-y-1 hover:border-violet-400/50"
              >
                <div className="relative h-52 bg-white/[0.03]">
                  {player.cover_url || player.profile_image_url ? (
                    <img src={player.cover_url || player.profile_image_url || ""} alt={player.display_name} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-gradient-to-br from-violet-500/25 to-black text-5xl font-semibold text-white/50">{player.display_name.charAt(0)}</div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#07060b] via-transparent to-transparent" />
                </div>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">{player.display_name}</h2>
                      {player.username ? <p className="mt-1 text-xs text-white/40">@{player.username.replace(/^@/, "")}</p> : null}
                    </div>
                    {player.is_verified ? <span className="rounded-full bg-violet-500/15 px-2.5 py-1 text-[10px] uppercase tracking-wider text-violet-200">Verificado</span> : null}
                  </div>
                  {player.tagline || player.short_bio ? <p className="mt-4 line-clamp-2 text-sm leading-6 text-white/60">{player.tagline || player.short_bio}</p> : null}
                  <div className="mt-5 flex flex-wrap gap-2">
                    {[...(player.professional_categories || []), ...(player.primary_role ? [player.primary_role] : [])].slice(0, 3).map((label) => <span key={label} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/50">{label}</span>)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </PublicShell>
  );
}
