"use client";

import Link from "next/link";
import { CheckCircle2, ExternalLink, Loader2, Music2, Unlink } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type PlayerSpotify = {
  id: string;
  slug: string;
  display_name: string;
  spotify_artist_id?: string | null;
  spotify_profile_url: string | null;
  spotify_sync_status?: string | null;
};

type ArtistPayload = {
  id: string;
  name: string;
  url: string;
  imageUrl: string | null;
};

export default function SpotifyArtistConnectPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [player, setPlayer] = useState<PlayerSpotify | null>(null);
  const [artistUrl, setArtistUrl] = useState("");
  const [artist, setArtist] = useState<ArtistPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const response = await authenticatedFetch("/api/players/me");
        const payload = await readApiJson<{ player: PlayerSpotify | null }>(response);
        if (!payload.player) {
          router.replace("/onboarding/identity");
          return;
        }
        if (!cancelled) {
          setPlayer(payload.player);
          setArtistUrl(payload.player.spotify_profile_url || "");
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "No se pudo cargar tu Player.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [router, user]);

  const connect = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/integrations/spotify/artist-link", {
        method: "POST",
        body: JSON.stringify({ artistUrl }),
      });
      const payload = await readApiJson<{ artist: ArtistPayload; player: PlayerSpotify }>(response);
      setArtist(payload.artist);
      setPlayer(payload.player);
      setArtistUrl(payload.artist.url);
      setMessage(`${payload.artist.name} quedó conectado a tu Player.`);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "No se pudo conectar Spotify Artist.");
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("¿Desvincular el perfil de artista de Spotify de tu Player público?")) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/integrations/spotify/artist-link", { method: "DELETE" });
      await readApiJson(response);
      setPlayer((current) => current ? { ...current, spotify_artist_id: null, spotify_profile_url: null, spotify_sync_status: "disconnected" } : current);
      setArtist(null);
      setArtistUrl("");
      setMessage("Spotify Artist fue desvinculado del Player.");
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "No se pudo desvincular Spotify Artist.");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !player) {
    return <main className="grid min-h-screen place-items-center bg-[#05040a] text-white"><Loader2 className="animate-spin text-violet-300" /></main>;
  }

  const connected = Boolean(player.spotify_profile_url);

  return (
    <main className="min-h-screen bg-[#05040a] px-4 py-10 text-white sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link href={`/${player.slug}`} className="text-sm text-white/55 transition hover:text-white">← Volver a mi perfil</Link>
          <Link href="/profile/edit" className="rounded-full border border-white/10 px-4 py-2 text-xs font-semibold text-white/70 hover:border-violet-400/40 hover:text-white">Editor del Player</Link>
        </div>

        <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#0d0b15] shadow-2xl">
          <div className="border-b border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(29,185,84,.18),transparent_42%)] p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#1DB954] text-black"><Music2 size={24} /></div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#57df87]">Música del Player</p>
                <h1 className="mt-1 text-3xl font-black tracking-[-0.04em]">Conectar Spotify for Artists</h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-white/55">Vinculá el perfil de artista que querés mostrar en CLOUVA. Ese perfil alimenta el botón “Escuchar música” y el reproductor público.</p>
              </div>
            </div>
          </div>

          <div className="space-y-6 p-6 sm:p-8">
            {connected ? (
              <div className="flex flex-col gap-4 rounded-2xl border border-[#1DB954]/30 bg-[#1DB954]/10 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="flex items-center gap-2 text-sm font-bold text-[#72e49a]"><CheckCircle2 size={17} /> Spotify Artist conectado</p>
                  <p className="mt-1 text-sm text-white/65">{artist?.name || player.display_name}</p>
                  <a href={player.spotify_profile_url || "#"} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-white/45 hover:text-white">Ver perfil en Spotify <ExternalLink size={12} /></a>
                </div>
                <button onClick={() => void disconnect()} disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-400/25 px-4 py-2.5 text-sm font-semibold text-red-300 disabled:opacity-50"><Unlink size={15} /> Desvincular</button>
              </div>
            ) : null}

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <p className="text-sm font-semibold">1. Entrá o reclamá tu perfil en Spotify for Artists</p>
              <p className="mt-1 text-xs leading-5 text-white/45">Spotify for Artists usa tu cuenta personal para darte acceso al perfil de artista. Si todavía no lo reclamaste, hacelo primero ahí.</p>
              <a href="https://artists.spotify.com/" target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#1DB954] px-4 py-2.5 text-sm font-black text-black transition hover:brightness-110">Abrir Spotify for Artists <ExternalLink size={14} /></a>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <label htmlFor="spotify-artist-url" className="text-sm font-semibold">2. Pegá el link de tu perfil de artista</label>
              <p className="mt-1 text-xs text-white/40">Ejemplo: https://open.spotify.com/artist/...</p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input id="spotify-artist-url" value={artistUrl} onChange={(event) => setArtistUrl(event.target.value)} placeholder="https://open.spotify.com/artist/..." className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm outline-none transition focus:border-[#1DB954]/60" />
                <button onClick={() => void connect()} disabled={saving || !artistUrl.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-bold transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-45">{saving ? <Loader2 size={16} className="animate-spin" /> : <Music2 size={16} />} {connected ? "Actualizar vínculo" : "Conectar a CLOUVA"}</button>
              </div>
            </div>

            {message ? <p className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{message}</p> : null}
            {error ? <p className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p> : null}

            <p className="text-xs leading-5 text-white/35">CLOUVA valida el perfil contra el catálogo oficial de Spotify y guarda únicamente el ID y la URL pública del artista. El acceso privado al dashboard de Spotify for Artists sigue administrado por Spotify.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
