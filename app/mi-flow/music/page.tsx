"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { useCurrentPlayer } from "@/components/current-player-provider";
import { PlayerSpotifyArtistManager } from "@/components/music/PlayerSpotifyArtistManager";
import { SpotifyConnectionCard } from "@/components/music/SpotifyConnectionCard";

type FlowStatus = "idea" | "escribiendo" | "grabando" | "mezclando" | "master" | "lanzado";
type FlowMusicTrack = { id: string; title: string; status: FlowStatus | null; created_at: string };

const statuses: FlowStatus[] = ["idea", "escribiendo", "grabando", "mezclando", "master", "lanzado"];
const labels: Record<FlowStatus, string> = {
  idea: "Idea",
  escribiendo: "Escribiendo",
  grabando: "Grabando",
  mezclando: "Mezclando",
  master: "Master",
  lanzado: "Lanzado",
};

export default function MusicHubPage() {
  const { user } = useAuth();
  const { currentPlayer } = useCurrentPlayer();
  const [rows, setRows] = useState<FlowMusicTrack[]>([]);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!user) return;
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase
      .from("flow_music_tracks")
      .select("id,title,status,created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });
    setRows((data ?? []) as FlowMusicTrack[]);
  };

  useEffect(() => { void load(); }, [user]);

  const create = async () => {
    if (!user || !title.trim() || saving) return;
    setSaving(true);
    try {
      const { supabase } = await import("@/lib/supabase");
      await supabase.from("flow_music_tracks").insert({ owner_id: user.id, title: title.trim(), status: "idea" });
      setTitle("");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id: string, status: FlowStatus) => {
    const { supabase } = await import("@/lib/supabase");
    await supabase.from("flow_music_tracks").update({ status }).eq("id", id);
    await load();
  };

  return (
    <main className="min-h-screen bg-[#05050a] px-4 py-7 text-white sm:px-6">
      <div className="mx-auto max-w-5xl">
        <p className="text-[10px] font-semibold uppercase tracking-[0.23em] text-violet-300/70">Mi Flow</p>
        <h1 className="mt-2 text-3xl font-black tracking-[-0.04em] sm:text-5xl">Mi música</h1>
        <p className="mt-2 max-w-2xl text-sm text-white/45">Tu Spotify personal, tu identidad artística y tus proyectos musicales viven en el mismo hub.</p>

        <div className="mt-7 grid gap-4 lg:grid-cols-2">
          <SpotifyConnectionCard compact />
          <section className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5">
            <p className="text-[10px] uppercase tracking-[0.2em] text-violet-300/65">Mi Spotify</p>
            <h2 className="mt-1 text-lg font-bold">Biblioteca y artistas</h2>
            <p className="mt-2 text-sm leading-5 text-white/45">Los corazones y los botones “Seguir” de CLOUVA actúan sobre tu cuenta Spotify conectada.</p>
            <Link href="/settings/connections" className="mt-4 inline-flex rounded-full border border-white/12 px-4 py-2 text-xs font-semibold hover:border-violet-400/45">Administrar conexiones</Link>
          </section>
        </div>

        {currentPlayer ? (
          <div className="mt-4">
            <PlayerSpotifyArtistManager playerId={currentPlayer.id} playerName={currentPlayer.display_name} />
          </div>
        ) : null}

        <section className="mt-8 rounded-[1.7rem] border border-white/10 bg-white/[0.025] p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-violet-300/65">Mis proyectos</p>
              <h2 className="mt-1 text-xl font-black">Proceso musical</h2>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void create(); }}
                placeholder="Nueva canción"
                className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/12 bg-black/25 px-3 text-sm outline-none focus:border-violet-400/50 sm:w-64"
              />
              <button type="button" onClick={create} disabled={!title.trim() || saving} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-black disabled:opacity-40"><Plus size={16} /> Crear</button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((row) => (
              <article key={row.id} className="rounded-2xl border border-white/[0.08] bg-black/20 p-4">
                <h3 className="truncate font-semibold">{row.title}</h3>
                <select
                  value={row.status || "idea"}
                  onChange={(event) => void setStatus(row.id, event.target.value as FlowStatus)}
                  aria-label={`Estado de ${row.title}`}
                  className="mt-3 w-full rounded-xl border border-white/10 bg-[#0d0d14] px-3 py-2 text-xs text-white outline-none"
                >
                  {statuses.map((status) => <option key={status} value={status}>{labels[status]}</option>)}
                </select>
              </article>
            ))}
          </div>

          {!rows.length ? <p className="mt-5 rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/35">Tus canciones van a aparecer acá desde la idea hasta el lanzamiento.</p> : null}
        </section>
      </div>
    </main>
  );
}
