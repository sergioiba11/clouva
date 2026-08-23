import { ExternalLink, Music2, Play } from "lucide-react";
import type { NormalizedMusicTrack } from "@/core/integrations/spotify/types";
import { SpotifyLikeButton } from "./SpotifyLikeButton";

export function MusicTrackCard({ track, interactive = true }: { track: NormalizedMusicTrack; interactive?: boolean }) {
  return (
    <article className="overflow-hidden rounded-[1.4rem] border border-white/10 bg-white/[0.025] p-3 shadow-xl">
      <a
        href={track.externalUrl}
        target="_blank"
        rel="noreferrer"
        className="block aspect-square overflow-hidden rounded-2xl bg-black/40"
        aria-label={`Abrir ${track.title} en Spotify`}
      >
        {track.coverUrl ? (
          <img src={track.coverUrl} alt={`Portada de ${track.album || track.title}`} className="h-full w-full object-contain" />
        ) : (
          <span className="grid h-full w-full place-items-center text-white/30"><Music2 size={32} /></span>
        )}
      </a>
      <div className="mt-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold text-white">{track.title}</h3>
          <p className="mt-0.5 truncate text-xs text-white/55">{track.artist}</p>
          {track.album ? <p className="mt-1 truncate text-[10px] text-white/30">{track.album}</p> : null}
        </div>
        {interactive ? <SpotifyLikeButton uri={track.uri} /> : null}
      </div>
      <a
        href={track.externalUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-[#7ee2a0] hover:text-[#1DB954]"
      >
        <Play size={13} fill="currentColor" /> Abrir en Spotify <ExternalLink size={12} />
      </a>
    </article>
  );
}
