"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AvatarPlaceholder, PublicShell } from "@/components/public/PublicShell";
import { playerPublicSelect, type Player } from "@/lib/players-data";

export default function PlayersDirectoryPage() {
  const [players, setPlayers] = useState<Player[] | null>(null);

  useEffect(() => {
    void (async () => {
      const { supabase } = await import("@/lib/supabase");
      const { data } = await supabase
        .from("players")
        .select(playerPublicSelect)
        .eq("is_published", true)
        .order("display_name");
      setPlayers((data ?? []) as Player[]);
    })();
  }, []);

  return (
    <PublicShell brand="PLAYERS" navLinks={[{ label: "La Matrix", href: "/matrix" }, { label: "Estudios", href: "/studios" }]}>
      <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl font-semibold">Players</h1>
        <p className="mt-2 text-white/60">Artistas, productores y creadores.</p>

        {players === null ? (
          <p className="mt-8 text-sm text-white/50">Cargando...</p>
        ) : players.length === 0 ? (
          <p className="mt-8 text-sm text-white/50">Todavía no hay Players publicados.</p>
        ) : (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {players.map((player) => (
              <Link
                key={player.id}
                href={`/players/${player.slug}`}
                className="group rounded-3xl border border-white/10 bg-white/[0.03] p-5 transition hover:-translate-y-1 hover:border-[#8f7cff]/50"
              >
                {player.profile_image_url ? (
                  <img src={player.profile_image_url} alt={player.display_name} className="h-32 w-full rounded-2xl object-cover" />
                ) : (
                  <AvatarPlaceholder label={player.display_name} className="h-32 w-full rounded-2xl text-3xl" />
                )}
                <h2 className="mt-4 text-lg font-semibold">{player.display_name}</h2>
                {player.primary_role ? <p className="text-sm text-white/50">{player.primary_role}</p> : null}
                {player.tagline ? <p className="mt-2 text-sm text-white/60">{player.tagline}</p> : null}
              </Link>
            ))}
          </div>
        )}
      </section>
    </PublicShell>
  );
}
