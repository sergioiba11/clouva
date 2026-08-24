"use client";

import { ExternalLink, LoaderCircle, RefreshCw, Unlink } from "lucide-react";
import { useEffect, useState } from "react";
import { authenticatedFetch } from "@/lib/authenticated-fetch";

type ArtistConnection = {
  id: string;
  external_artist_id: string;
  external_uri: string;
  external_url: string;
  artist_name: string;
  artist_image_url: string | null;
  verification_status: "unverified" | "verified";
  last_synced_at: string | null;
};

export function PlayerSpotifyArtistManager({ playerId, playerName }: { playerId: string; playerName: string }) {
  const [connection, setConnection] = useState<ArtistConnection | null>(null);
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const response = await authenticatedFetch(`/api/integrations/spotify/artist/status?playerId=${encodeURIComponent(playerId)}`);
      const payload = await response.json().catch(() => ({})) as { connection?: ArtistConnection | null };
      setConnection(response.ok ? payload.connection || null : null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [playerId]);

  const link = async () => {
    if (!value.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/integrations/spotify/artist/link", {
        method: "POST",
        body: JSON.stringify({ playerId, value: value.trim() }),
      });
      const payload = await response.json().catch(() => ({})) as { artist?: { name?: string }; tracks?: number; syncWarning?: string | null };
      if (!response.ok) throw new Error("No pudimos vincular ese Spotify Artist.");
      setValue("");
      setMessage(payload.syncWarning ? `Artista vinculado. El catálogo queda pendiente de sincronización.` : `${payload.artist?.name || "Artista"} vinculado · ${payload.tracks || 0} tracks sincronizados.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo vincular Spotify Artist.");
      setLoading(false);
    }
  };

  const sync = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/integrations/spotify/artist/sync", { method: "POST", body: JSON.stringify({ playerId }) });
      const payload = await response.json().catch(() => ({})) as { tracks?: number };
      if (!response.ok) throw new Error("No se pudo sincronizar el catálogo.");
      setMessage(`${payload.tracks || 0} tracks sincronizados.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo sincronizar.");
      setLoading(false);
    }
  };

  const unlink = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/integrations/spotify/artist/unlink", { method: "POST", body: JSON.stringify({ playerId }) });
      if (!response.ok) throw new Error("No se pudo desvincular Spotify Artist.");
      setConnection(null);
      setMessage("Spotify Artist desvinculado del Player.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo desvincular.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-violet-300/65">Mi carrera</p>
          <h2 className="mt-1 text-lg font-bold">Spotify Artist</h2>
          <p className="mt-1 text-xs text-white/40">Vinculá el perfil artístico de {playerName}. Es independiente de tu Spotify personal.</p>
        </div>
        {loading ? <LoaderCircle size={18} className="animate-spin text-white/40" /> : null}
      </div>

      {connection ? (
        <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-[#1DB954]/20 bg-[#1DB954]/[0.06] p-4 sm:flex-row sm:items-center">
          {connection.artist_image_url ? <img src={connection.artist_image_url} alt="" className="h-14 w-14 rounded-full object-cover" /> : null}
          <div className="min-w-0 flex-1">
            <p className="font-bold">{connection.artist_name}</p>
            <p className="mt-1 text-[11px] text-white/45">{connection.verification_status === "verified" ? "Spotify Artist ✓" : "Spotify Artist vinculado"}</p>
            {connection.last_synced_at ? <p className="mt-1 text-[10px] text-white/30">Última sincronización: {new Date(connection.last_synced_at).toLocaleString()}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={connection.external_url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 px-3 text-xs"><ExternalLink size={13} /> Spotify</a>
            <button type="button" onClick={sync} disabled={loading} aria-label="Sincronizar catálogo de Spotify" className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 px-3 text-xs"><RefreshCw size={13} /> Sync</button>
            <button type="button" onClick={unlink} disabled={loading} aria-label="Desvincular Spotify Artist" className="inline-flex h-9 items-center gap-2 rounded-full border border-rose-400/20 px-3 text-xs text-rose-200"><Unlink size={13} /> Desvincular</button>
          </div>
        </div>
      ) : (
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="URL, URI, ID o nombre del artista"
            className="min-h-11 flex-1 rounded-xl border border-white/10 bg-black/25 px-3 text-sm outline-none focus:border-violet-400/50"
          />
          <button type="button" onClick={link} disabled={loading || !value.trim()} className="min-h-11 rounded-xl bg-white px-5 text-sm font-bold text-black disabled:opacity-45">Vincular Spotify Artist</button>
        </div>
      )}
      {message ? <p className="mt-3 text-xs text-white/55">{message}</p> : null}
    </section>
  );
}
