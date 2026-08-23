"use client";

import { CheckCircle2, LoaderCircle, Music2, Unplug } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import type { SpotifyPublicConnection } from "@/core/integrations/spotify/types";
import { disconnectSpotifyConnection, getSpotifyConnectionStatus, startSpotifyConnection } from "@/lib/music/spotify-client";

export function SpotifyConnectionCard({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [connection, setConnection] = useState<SpotifyPublicConnection | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!user) {
      setLoading(false);
      setConnection(null);
      return;
    }
    setLoading(true);
    try {
      const result = await getSpotifyConnectionStatus();
      setEnabled(result.enabled);
      setConnection(result.connection);
      setError(null);
    } catch {
      setError("No pudimos leer el estado de Spotify.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [user]);

  const connect = async () => {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(pathname || "/settings/connections")}`);
      return;
    }
    setLoading(true);
    try {
      await startSpotifyConnection({ returnPath: pathname || "/settings/connections" });
    } catch {
      setError("No se pudo iniciar la conexión con Spotify.");
      setLoading(false);
    }
  };

  const disconnect = async () => {
    setLoading(true);
    try {
      await disconnectSpotifyConnection();
      await load();
    } catch {
      setError("No se pudo desconectar Spotify.");
      setLoading(false);
    }
  };

  return (
    <section className={`rounded-[1.6rem] border border-white/10 bg-white/[0.035] ${compact ? "p-4" : "p-5 sm:p-6"}`}>
      <div className="flex items-start gap-4">
        {connection?.avatarUrl ? (
          <img src={connection.avatarUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
        ) : (
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#1DB954]/15 text-[#77e49b]"><Music2 size={22} /></span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-bold text-white">Spotify</h2>
            {connection?.connected ? <span className="inline-flex items-center gap-1 rounded-full bg-[#1DB954]/15 px-2 py-1 text-[10px] font-semibold text-[#8ff0b0]"><CheckCircle2 size={12} /> Conectado</span> : null}
          </div>
          {connection?.connected ? (
            <p className="mt-1 text-sm text-white/55">{connection.displayName || "Cuenta Spotify"}</p>
          ) : (
            <p className="mt-1 text-sm leading-5 text-white/50">Conectá tu cuenta para guardar canciones y seguir artistas desde CLOUVA.</p>
          )}
          {error ? <p className="mt-2 text-xs text-rose-300">{error}</p> : null}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {loading ? (
          <span className="inline-flex items-center gap-2 text-xs text-white/45"><LoaderCircle size={15} className="animate-spin" /> Comprobando…</span>
        ) : connection?.connected ? (
          <button type="button" onClick={disconnect} className="inline-flex items-center gap-2 rounded-full border border-white/12 px-4 py-2 text-xs font-semibold text-white/70 hover:border-white/25"><Unplug size={14} /> Desconectar</button>
        ) : (
          <button type="button" onClick={connect} disabled={!enabled} className="rounded-full bg-[#1DB954] px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45">
            {enabled ? "Conectar Spotify" : "Spotify próximamente"}
          </button>
        )}
      </div>
    </section>
  );
}
