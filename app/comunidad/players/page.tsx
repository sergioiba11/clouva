"use client";
import { useEffect, useState } from "react";
import { MainFooter, MainNav } from "@/components/layout";
import { PlayerCard } from "@/components/community/player-card";

type PlayerRow = {
  id: string;
  username: string;
  full_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  city: string | null;
};

export default function PlayersPage() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { supabase } = await import("@/lib/supabase");
      const { data } = await supabase
        .from("profiles")
        .select("id,username,full_name,display_name,avatar_url,city")
        .not("username", "is", null)
        .order("created_at", { ascending: false })
        .limit(200);
      setPlayers((data ?? []) as PlayerRow[]);
      setLoading(false);
    })();
  }, []);

  return (
    <main>
      <MainNav />
      <section className="mx-auto max-w-7xl px-4 py-14 md:px-8">
        <h1 className="text-4xl font-semibold">Players</h1>
        <p className="mt-2 text-sm text-white/60">Artistas, productores y creadores de la comunidad CLOUVA.</p>

        {loading ? (
          <p className="mt-10 text-white/50">Cargando...</p>
        ) : players.length === 0 ? (
          <p className="mt-10 text-white/50">Todavía no hay players con perfil público.</p>
        ) : (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {players.map((player) => (
              <PlayerCard
                key={player.id}
                username={player.username}
                name={player.full_name || player.display_name || `@${player.username}`}
                avatarUrl={player.avatar_url}
                city={player.city}
              />
            ))}
          </div>
        )}
      </section>
      <MainFooter />
    </main>
  );
}
