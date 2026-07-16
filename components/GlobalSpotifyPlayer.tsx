"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ExternalLink, Music2, X } from "lucide-react";

const SPOTIFY_ALBUM_ID = "6dtuD2cWFty44bX6uZiptN";
const SPOTIFY_ALBUM_URL = `https://open.spotify.com/album/${SPOTIFY_ALBUM_ID}`;
const SPOTIFY_EMBED_URL = `https://open.spotify.com/embed/album/${SPOTIFY_ALBUM_ID}?utm_source=generator&theme=0`;
const STORAGE_KEY = "clouva:spotify-player-state";

type PlayerState = "expanded" | "compact" | "hidden";

export function GlobalSpotifyPlayer() {
  const [state, setState] = useState<PlayerState>("hidden");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "expanded") {
      setState("expanded");
    } else {
      setState("hidden");
      window.localStorage.setItem(STORAGE_KEY, "hidden");
    }
    setMounted(true);
  }, []);

  function updateState(nextState: PlayerState) {
    setState(nextState);
    window.localStorage.setItem(STORAGE_KEY, nextState);
  }

  if (!mounted) return null;

  if (state !== "expanded") {
    return (
      <button
        type="button"
        onClick={() => updateState("expanded")}
        aria-label="Abrir reproductor de música"
        title="CLOUVA Music"
        className="fixed bottom-4 right-4 z-[100] flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-black/90 text-white shadow-2xl backdrop-blur-xl transition hover:scale-105 hover:border-[#1ed760]/70"
      >
        <Music2 className="h-6 w-6 text-[#1ed760]" />
      </button>
    );
  }

  return (
    <aside
      aria-label="Reproductor global de Spotify"
      className="fixed bottom-3 left-3 right-3 z-[100] mx-auto w-[calc(100%-1.5rem)] max-w-[520px] overflow-hidden rounded-2xl border border-white/15 bg-black/95 text-white shadow-[0_24px_80px_rgba(0,0,0,0.65)] backdrop-blur-xl sm:left-auto sm:right-4 sm:w-[420px]"
    >
      <div className="flex min-h-14 items-center gap-3 px-3 py-2">
        <button
          type="button"
          onClick={() => updateState("hidden")}
          aria-label="Minimizar reproductor"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1ed760] text-black">
            <Music2 className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[10px] font-bold uppercase tracking-[0.22em] text-[#1ed760]">
              Sonando en CLOUVA
            </span>
            <span className="block truncate text-sm font-semibold">Clover en Spotify</span>
          </span>
          <ChevronDown className="h-5 w-5 text-white/60" />
        </button>

        <a
          href={SPOTIFY_ALBUM_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Abrir álbum en Spotify"
          className="rounded-full p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
        <button
          type="button"
          onClick={() => updateState("hidden")}
          aria-label="Cerrar reproductor"
          className="rounded-full p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="border-t border-white/10">
        <iframe
          title="Clover en Spotify"
          src={SPOTIFY_EMBED_URL}
          width="100%"
          height="352"
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
          className="block border-0"
        />
      </div>
    </aside>
  );
}
