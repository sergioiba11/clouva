"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useState } from "react";
import { useSpotifyPlayback } from "@/components/music/SpotifyPlaybackProvider";
import { startSpotifyConnection } from "@/lib/music/spotify-client";

function formatTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function SpotifyAssistantMiniPlayer() {
  const pathname = usePathname();
  const {
    enabled,
    connected,
    scopesReady,
    playback,
    loading,
    busyAction,
    controlPlayback,
  } = useSpotifyPlayback();
  const [connecting, setConnecting] = useState(false);

  if (loading || !enabled || !connected) return null;

  if (!scopesReady) {
    const reconnect = async () => {
      if (connecting) return;
      setConnecting(true);
      try {
        await startSpotifyConnection({ returnPath: pathname || "/" });
      } finally {
        setConnecting(false);
      }
    };

    return (
      <section className="rounded-2xl border border-[#1ed760]/25 bg-[#1ed760]/[0.055] p-3" aria-label="Spotify conectado">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#71f3a0]">Spotify conectado</p>
            <p className="mt-1 text-xs text-white/55">Activá los permisos de reproducción para controlar tu música desde Trébol.</p>
          </div>
          <button
            type="button"
            onClick={reconnect}
            disabled={connecting}
            className="shrink-0 rounded-full bg-[#1ed760] px-3 py-2 text-[10px] font-extrabold text-[#06120a] disabled:opacity-60"
          >
            {connecting ? "Abriendo…" : "Activar"}
          </button>
        </div>
      </section>
    );
  }

  if (!playback?.track) {
    return (
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3" aria-label="Spotify sin reproducción activa">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#71f3a0]">Spotify conectado</p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <p className="text-xs text-white/50">No hay una reproducción activa en este momento.</p>
          <Link href="/mi-flow/music" className="shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-[10px] text-white/70 hover:bg-white/10">Música</Link>
        </div>
      </section>
    );
  }

  const progress = playback.durationMs > 0
    ? Math.min(100, Math.max(0, (playback.progressMs / playback.durationMs) * 100))
    : 0;

  const run = (action: "play" | "pause" | "next" | "previous") => {
    void controlPlayback(action).catch(() => undefined);
  };

  return (
    <section className="rounded-2xl border border-[#1ed760]/20 bg-black/35 p-3" aria-label={`Spotify: ${playback.track.title}`}>
      <div className="flex items-center gap-3">
        {playback.track.coverUrl ? (
          <img src={playback.track.coverUrl} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
        ) : (
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#1ed760]/15 text-[#1ed760]"><Play size={17} /></span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#71f3a0]">Spotify</p>
          <p className="truncate text-xs font-semibold text-white">{playback.track.title}</p>
          <p className="truncate text-[10px] text-white/45">{playback.track.artist}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => run("previous")} disabled={Boolean(busyAction)} aria-label="Tema anterior" className="rounded-full p-2 text-white/65 hover:bg-white/10 disabled:opacity-40"><SkipBack size={14} fill="currentColor" /></button>
          <button type="button" onClick={() => run(playback.isPlaying ? "pause" : "play")} disabled={Boolean(busyAction)} aria-label={playback.isPlaying ? "Pausar" : "Reproducir"} className="grid h-8 w-8 place-items-center rounded-full bg-[#1ed760] text-[#06120a] disabled:opacity-60">
            {playback.isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
          </button>
          <button type="button" onClick={() => run("next")} disabled={Boolean(busyAction)} aria-label="Tema siguiente" className="rounded-full p-2 text-white/65 hover:bg-white/10 disabled:opacity-40"><SkipForward size={14} fill="currentColor" /></button>
        </div>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-[#1ed760]" style={{ width: `${progress}%` }} /></div>
      <div className="mt-1 flex justify-between text-[9px] text-white/35"><span>{formatTime(playback.progressMs)}</span><span>{formatTime(playback.durationMs)}</span></div>
    </section>
  );
}
