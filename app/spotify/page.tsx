"use client";

import { useCallback, useEffect, useState } from "react";
import { Music2, ExternalLink, Loader2, Unplug } from "lucide-react";
import { supabase } from "@/lib/supabase";

type SpotifyImage = { url: string };
type SpotifyArtist = { id: string; name: string; images?: SpotifyImage[]; external_urls?: { spotify?: string } };
type SpotifyTrack = { id: string; name: string; album?: { name: string; images?: SpotifyImage[] }; artists?: Array<{ name: string }>; external_urls?: { spotify?: string } };
type SpotifyData = {
  connected: boolean;
  connection?: { spotify_display_name?: string; spotify_avatar_url?: string; spotify_profile_url?: string };
  topTracks?: { items?: SpotifyTrack[] };
  topArtists?: { items?: SpotifyArtist[] };
  recentlyPlayed?: { items?: Array<{ track: SpotifyTrack }> };
  currentlyPlaying?: { item?: SpotifyTrack; is_playing?: boolean } | null;
};

async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

export default function SpotifyPage() {
  const [data, setData] = useState<SpotifyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const token = await getAccessToken();
    if (!token) {
      setError("Iniciá sesión en CLOUVA para conectar Spotify.");
      setLoading(false);
      return;
    }
    const response = await fetch("/api/spotify/data", { headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json();
    if (!response.ok) setError(payload.error || "No se pudo cargar Spotify.");
    else setData(payload);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function connect() {
    setAction(true);
    setError(null);
    const token = await getAccessToken();
    if (!token) {
      setError("Iniciá sesión antes de conectar Spotify.");
      setAction(false);
      return;
    }
    const response = await fetch("/api/spotify/connect", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json();
    if (!response.ok || !payload.url) {
      setError(payload.error || "No se pudo iniciar la conexión.");
      setAction(false);
      return;
    }
    window.location.href = payload.url;
  }

  async function disconnect() {
    setAction(true);
    const token = await getAccessToken();
    if (!token) return;
    const response = await fetch("/api/spotify/data", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) setData({ connected: false });
    else setError("No se pudo desconectar Spotify.");
    setAction(false);
  }

  if (loading) return <main className="min-h-screen bg-black text-white grid place-items-center"><Loader2 className="animate-spin" /></main>;

  return (
    <main className="min-h-screen bg-black text-white px-5 py-10">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#1ed760] text-black"><Music2 /></div>
          <div><h1 className="text-3xl font-semibold">Spotify en CLOUVA</h1><p className="text-white/55">Tu música conectada con tu perfil y avatar.</p></div>
        </div>

        {error && <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-200">{error}</div>}

        {!data?.connected ? (
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-8 text-center">
            <h2 className="mb-2 text-2xl font-semibold">Conectá tu identidad musical</h2>
            <p className="mx-auto mb-6 max-w-xl text-white/60">CLOUVA podrá mostrar tus artistas, canciones favoritas, historial reciente y lo que estás escuchando.</p>
            <button onClick={connect} disabled={action} className="rounded-full bg-[#1ed760] px-7 py-3 font-semibold text-black disabled:opacity-50">{action ? "Conectando…" : "Conectar Spotify"}</button>
          </section>
        ) : (
          <>
            <section className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.04] p-6">
              <div className="flex items-center gap-4">
                {data.connection?.spotify_avatar_url ? <img src={data.connection.spotify_avatar_url} alt="Spotify" className="h-16 w-16 rounded-full object-cover" /> : <div className="h-16 w-16 rounded-full bg-white/10" />}
                <div><p className="text-sm text-[#1ed760]">Spotify conectado</p><h2 className="text-xl font-semibold">{data.connection?.spotify_display_name || "Usuario de Spotify"}</h2></div>
              </div>
              <div className="flex gap-3">
                {data.connection?.spotify_profile_url && <a href={data.connection.spotify_profile_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm">Abrir perfil <ExternalLink size={15} /></a>}
                <button onClick={disconnect} disabled={action} className="flex items-center gap-2 rounded-full border border-red-400/25 px-4 py-2 text-sm text-red-300"><Unplug size={15} /> Desconectar</button>
              </div>
            </section>

            {data.currentlyPlaying?.item && <MusicRow title="Escuchando ahora" track={data.currentlyPlaying.item} large />}

            <Grid title="Tus canciones favoritas" items={data.topTracks?.items || []} />
            <ArtistGrid title="Tus artistas favoritos" items={data.topArtists?.items || []} />
            <Grid title="Escuchado recientemente" items={(data.recentlyPlayed?.items || []).map((item) => item.track)} />
          </>
        )}
      </div>
    </main>
  );
}

function Grid({ title, items }: { title: string; items: SpotifyTrack[] }) {
  if (!items.length) return null;
  return <section className="mb-10"><h2 className="mb-4 text-xl font-semibold">{title}</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map((track) => <MusicRow key={track.id} track={track} />)}</div></section>;
}

function MusicRow({ track, title, large = false }: { track: SpotifyTrack; title?: string; large?: boolean }) {
  const image = track.album?.images?.[0]?.url;
  return <a href={track.external_urls?.spotify} target="_blank" rel="noreferrer" className={`mb-4 flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3 hover:bg-white/[0.08] ${large ? "max-w-xl" : ""}`}>{image && <img src={image} alt="" className={large ? "h-20 w-20 rounded-xl object-cover" : "h-14 w-14 rounded-xl object-cover"} />}<div className="min-w-0">{title && <p className="text-xs uppercase tracking-wider text-[#1ed760]">{title}</p>}<p className="truncate font-medium">{track.name}</p><p className="truncate text-sm text-white/50">{track.artists?.map((a) => a.name).join(", ")}</p></div></a>;
}

function ArtistGrid({ title, items }: { title: string; items: SpotifyArtist[] }) {
  if (!items.length) return null;
  return <section className="mb-10"><h2 className="mb-4 text-xl font-semibold">{title}</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">{items.map((artist) => <a key={artist.id} href={artist.external_urls?.spotify} target="_blank" rel="noreferrer" className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-center hover:bg-white/[0.08]">{artist.images?.[0]?.url && <img src={artist.images[0].url} alt="" className="mb-3 aspect-square w-full rounded-full object-cover" />}<p className="truncate font-medium">{artist.name}</p></a>)}</div></section>;
}
