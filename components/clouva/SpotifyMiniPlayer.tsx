"use client";

import { Pause, Play } from "lucide-react";
import { useState } from "react";

const mockTrack = {
  title: "Midnight Clover",
  artist: "CLOUVA Radio",
};

export function SpotifyMiniPlayer({ visible }: { visible: boolean }) {
  const [playing, setPlaying] = useState(false);

  return (
    <section className={`clouva-spotify ${visible ? "clouva-spotify-visible" : ""}`} onClick={(event) => event.stopPropagation()} aria-label="Reproductor Spotify mock">
      <div className="h-9 w-9 rounded-xl border border-emerald-200/10 bg-[radial-gradient(circle_at_35%_25%,rgba(139,92,246,.34),rgba(8,8,12,.95)_62%)]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-white/82">{mockTrack.title}</p>
        <p className="truncate text-[10px] text-white/45">{mockTrack.artist}</p>
      </div>
      <button type="button" aria-label={playing ? "Pausar" : "Reproducir"} onClick={() => setPlaying((value) => !value)} className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition hover:text-[#ddd6fe]">
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 translate-x-px" />}
      </button>
    </section>
  );
}
