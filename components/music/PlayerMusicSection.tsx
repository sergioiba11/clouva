import { BadgeCheck, Music2 } from "lucide-react";
import type { NormalizedMusicTrack } from "@/core/integrations/spotify/types";
import type { ExternalMusicTrack, PlayerMusicConnection } from "@/lib/players-data";
import { MusicTrackCard } from "./MusicTrackCard";
import { SpotifyFollowArtistButton } from "./SpotifyFollowArtistButton";

function normalize(track: ExternalMusicTrack): NormalizedMusicTrack {
  return {
    provider: "spotify",
    id: track.external_track_id,
    uri: track.external_track_uri,
    albumId: track.external_album_id,
    title: track.title,
    artist: track.artist_name,
    album: track.album_name,
    coverUrl: track.cover_url,
    externalUrl: track.external_url,
    releaseDate: track.release_date,
  };
}

export function PlayerMusicSection({
  connection,
  tracks,
}: {
  connection: PlayerMusicConnection | null;
  tracks: ExternalMusicTrack[];
}) {
  if (!connection && tracks.length === 0) return null;
  return (
    <section id="musica" className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="rounded-[1.7rem] border border-white/10 bg-white/[0.025] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#7ee2a0]">Música</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-black">Spotify Artist</h2>
              {connection?.verification_status === "verified" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#1DB954]/15 px-2 py-1 text-[10px] font-semibold text-[#8ff0b0]"><BadgeCheck size={12} /> Verificado</span>
              ) : null}
            </div>
            {connection ? <a href={connection.external_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-white/45 hover:text-white"><Music2 size={13} /> {connection.artist_name} en Spotify</a> : null}
          </div>
          {connection ? <SpotifyFollowArtistButton uri={connection.external_uri} /> : null}
        </div>

        {tracks.length ? (
          <div className="mt-6">
            <h3 className="mb-3 text-sm font-semibold text-white/80">Últimos lanzamientos</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {tracks.slice(0, 8).map((track) => <MusicTrackCard key={track.id} track={normalize(track)} />)}
            </div>
          </div>
        ) : (
          <p className="mt-5 text-sm text-white/40">El catálogo se está preparando para CLOUVA.</p>
        )}
      </div>
    </section>
  );
}
