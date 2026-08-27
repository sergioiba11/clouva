"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Disc3,
  Headphones,
  Loader2,
  Music2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
} from "lucide-react";
import { MainNav } from "@/components/layout";
import { useAuth } from "@/components/auth-provider";
import { useCurrentPlayer } from "@/components/current-player-provider";
import { useSpotifyPlayback } from "@/components/music/SpotifyPlaybackProvider";
import { startSpotifyConnection } from "@/lib/music/spotify-client";

type TrackStatus = "idea" | "escribiendo" | "grabando" | "mezclando" | "master" | "lanzado";

type FlowMusicTrack = {
  id: string;
  title: string;
  status: TrackStatus | null;
  created_at?: string | null;
};

const STATUS_META: Array<{ value: TrackStatus; label: string; dot: string }> = [
  { value: "idea", label: "Idea", dot: "bg-violet-400" },
  { value: "escribiendo", label: "Escribiendo", dot: "bg-fuchsia-400" },
  { value: "grabando", label: "Grabando", dot: "bg-rose-400" },
  { value: "mezclando", label: "Mezclando", dot: "bg-amber-400" },
  { value: "master", label: "Master", dot: "bg-cyan-400" },
  { value: "lanzado", label: "Lanzado", dot: "bg-emerald-400" },
];

function formatTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export default function MusicPage() {
  const { user } = useAuth();
  const { currentPlayer } = useCurrentPlayer();
  const {
    enabled,
    connected,
    scopesReady,
    connection,
    playback,
    loading: spotifyLoading,
    error: spotifyError,
    busyAction,
    refreshPlayback,
    controlPlayback,
  } = useSpotifyPlayback();

  const [rows, setRows] = useState<FlowMusicTrack[]>([]);
  const [title, setTitle] = useState("");
  const [tracksLoading, setTracksLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [trackError, setTrackError] = useState<string | null>(null);

  const loadTracks = useCallback(async () => {
    if (!user) {
      setRows([]);
      setTracksLoading(false);
      return;
    }
    setTracksLoading(true);
    setTrackError(null);
    try {
      const { supabase } = await import("@/lib/supabase");
      const { data, error } = await supabase
        .from("flow_music_tracks")
        .select("id,title,status,created_at")
        .eq("owner_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRows((data || []) as FlowMusicTrack[]);
    } catch (error) {
      setTrackError(error instanceof Error ? error.message : "No se pudieron cargar tus canciones.");
    } finally {
      setTracksLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadTracks();
  }, [loadTracks]);

  const createTrack = useCallback(async () => {
    const cleanTitle = title.trim();
    if (!user || !cleanTitle || saving) return;
    setSaving(true);
    setTrackError(null);
    try {
      const { supabase } = await import("@/lib/supabase");
      const { error } = await supabase.from("flow_music_tracks").insert({
        owner_id: user.id,
        title: cleanTitle,
        status: "idea",
      });
      if (error) throw error;
      setTitle("");
      await loadTracks();
    } catch (error) {
      setTrackError(error instanceof Error ? error.message : "No se pudo crear la canción.");
    } finally {
      setSaving(false);
    }
  }, [loadTracks, saving, title, user]);

  const updateStatus = useCallback(async (trackId: string, status: TrackStatus) => {
    setTrackError(null);
    try {
      const { supabase } = await import("@/lib/supabase");
      const { error } = await supabase.from("flow_music_tracks").update({ status }).eq("id", trackId);
      if (error) throw error;
      setRows((current) => current.map((row) => (row.id === trackId ? { ...row, status } : row)));
    } catch (error) {
      setTrackError(error instanceof Error ? error.message : "No se pudo actualizar el estado.");
      await loadTracks();
    }
  }, [loadTracks]);

  const connectSpotify = useCallback(async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      await startSpotifyConnection({ returnPath: "/mi-flow/music" });
    } catch {
      setConnecting(false);
    }
  }, [connecting]);

  const counts = useMemo(() => {
    const result = new Map<TrackStatus, number>();
    for (const item of STATUS_META) result.set(item.value, 0);
    for (const row of rows) {
      const status = (row.status || "idea") as TrackStatus;
      result.set(status, (result.get(status) || 0) + 1);
    }
    return result;
  }, [rows]);

  const progress = playback && playback.durationMs > 0
    ? Math.min(100, Math.max(0, (playback.progressMs / playback.durationMs) * 100))
    : 0;

  const statusLabel = connected
    ? scopesReady
      ? "Spotify conectado"
      : "Spotify necesita permisos"
    : "Conectá Spotify";

  const identityArtwork = currentPlayer?.profile_image_url || connection?.avatarUrl || currentPlayer?.cover_url || currentPlayer?.hero_image_url || null;
  const identityBackdrop = currentPlayer?.cover_url || currentPlayer?.hero_image_url || identityArtwork;
  const activeArtwork = playback?.track.coverUrl || identityArtwork;
  const activeBackdrop = playback?.track.coverUrl || identityBackdrop;
  const spotifyProfileUrl = currentPlayer?.spotify_profile_url || null;

  return (
    <main className="min-h-screen bg-[#06060f] text-white">
      <MainNav />

      <div className="relative overflow-hidden border-b border-white/5">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(124,58,237,0.2),transparent_34%),radial-gradient(circle_at_85%_30%,rgba(30,215,96,0.1),transparent_28%)]" />
        <section className="relative mx-auto flex max-w-7xl flex-col gap-5 px-4 py-9 md:flex-row md:items-end md:justify-between md:px-8 md:py-12">
          <div>
            <Link href="/" className="mb-5 inline-flex items-center gap-2 text-xs font-medium text-white/45 transition hover:text-white/75">
              <ArrowLeft className="h-4 w-4" /> Volver al inicio
            </Link>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.24em] text-violet-300">
              <Music2 className="h-4 w-4" /> MI FLOW · MÚSICA
            </div>
            <h1 className="max-w-3xl text-4xl font-black tracking-[-0.045em] md:text-6xl">CLOUVA Music.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/50 md:text-base">
              Tu reproducción de Spotify y tu proceso creativo, unidos en una sola superficie.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshPlayback()}
            disabled={spotifyLoading}
            className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-semibold text-white/70 transition hover:border-violet-300/30 hover:bg-violet-400/10 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${spotifyLoading ? "animate-spin" : ""}`} />
            Actualizar Spotify
          </button>
        </section>
      </div>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 pb-28 md:px-8 md:py-8 md:pb-16">
        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.72fr)_minmax(270px,0.68fr)]">
          <article className="relative min-h-[330px] overflow-hidden rounded-[28px] border border-violet-300/15 bg-[#0b0b16] p-5 shadow-[0_30px_90px_rgba(0,0,0,0.34)] md:p-7">
            {activeBackdrop ? (
              <div
                className="pointer-events-none absolute inset-0 scale-110 bg-cover bg-center opacity-[0.14] blur-2xl"
                style={{ backgroundImage: `url(${activeBackdrop})` }}
              />
            ) : null}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet-950/55 via-[#0b0b16]/92 to-[#0b0b16]" />

            <div className="relative flex h-full flex-col gap-6 md:flex-row md:items-center">
              <div className="aspect-square w-full shrink-0 overflow-hidden rounded-2xl border border-violet-200/15 bg-gradient-to-br from-violet-500/25 to-black shadow-[0_20px_55px_rgba(0,0,0,0.35)] md:w-56">
                {activeArtwork ? (
                  <img src={activeArtwork} alt={playback ? `Portada de ${playback.track.title}` : "Identidad musical CLOUVA"} className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center">
                    <Disc3 className="h-20 w-20 text-violet-300/45" />
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold ${connected ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-white/10 bg-white/[0.04] text-white/50"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-[#1ed760] shadow-[0_0_10px_#1ed760]" : "bg-white/30"}`} />
                    {statusLabel}
                  </span>
                  {playback?.device?.name ? (
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-white/45">{playback.device.name}</span>
                  ) : null}
                </div>

                {playback ? (
                  <>
                    <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.22em] text-white/35">SONANDO AHORA</p>
                    <h2 className="mt-2 truncate text-3xl font-black tracking-[-0.035em] md:text-4xl">{playback.track.title}</h2>
                    <p className="mt-1 truncate text-sm font-medium text-white/60 md:text-base">{playback.track.artist}</p>
                    {playback.track.album ? <p className="mt-1 truncate text-xs text-white/35">{playback.track.album}</p> : null}

                    <div className="mt-6">
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-[#1ed760]" style={{ width: `${progress}%` }} />
                      </div>
                      <div className="mt-2 flex justify-between text-[11px] tabular-nums text-white/35">
                        <span>{formatTime(playback.progressMs)}</span>
                        <span>{formatTime(playback.durationMs)}</span>
                      </div>
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => void controlPlayback("previous")} disabled={Boolean(busyAction)} aria-label="Anterior" className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-40"><SkipBack className="h-5 w-5" /></button>
                      <button type="button" onClick={() => void controlPlayback(playback.isPlaying ? "pause" : "play")} disabled={Boolean(busyAction)} aria-label={playback.isPlaying ? "Pausar" : "Reproducir"} className="grid h-14 w-14 place-items-center rounded-full bg-white text-black shadow-[0_0_28px_rgba(255,255,255,0.15)] transition hover:scale-105 disabled:opacity-50">
                        {busyAction === "play" || busyAction === "pause" ? <Loader2 className="h-5 w-5 animate-spin" /> : playback.isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
                      </button>
                      <button type="button" onClick={() => void controlPlayback("next")} disabled={Boolean(busyAction)} aria-label="Siguiente" className="grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-40"><SkipForward className="h-5 w-5" /></button>
                      {playback.track.externalUrl ? (
                        <a href={playback.track.externalUrl} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-xs text-white/55 transition hover:border-[#1ed760]/30 hover:text-white">Abrir en Spotify <ArrowUpRight className="h-3.5 w-3.5" /></a>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="mt-5 max-w-lg">
                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/35">CLOUVA MUSIC</p>
                    <h2 className="mt-2 text-2xl font-black tracking-[-0.03em] md:text-3xl">
                      {!connected ? "Conectá tu Spotify" : !scopesReady ? "Activá el control de reproducción" : "Poné algo a sonar"}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-white/48">
                      {!connected
                        ? "Vinculá tu cuenta para ver la canción actual y controlarla desde CLOUVA."
                        : !scopesReady
                          ? "Tu cuenta está vinculada, pero necesita aceptar los permisos de playback."
                          : "Spotify está conectado. Abrilo, reproducí cualquier canción y CLOUVA la va a detectar automáticamente."}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2">
                      {!connected || !scopesReady ? (
                        <button type="button" onClick={() => void connectSpotify()} disabled={connecting || !enabled} className="inline-flex items-center gap-2 rounded-full bg-[#1ed760] px-5 py-3 text-sm font-bold text-black transition hover:brightness-105 disabled:opacity-50">
                          {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Headphones className="h-4 w-4" />}
                          {connected ? "Dar permisos de playback" : "Conectar Spotify"}
                        </button>
                      ) : (
                        <a href="https://open.spotify.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full bg-[#1ed760] px-5 py-3 text-sm font-bold text-black transition hover:brightness-105">
                          <Play className="h-4 w-4 fill-current" /> Abrir Spotify
                        </a>
                      )}
                      {spotifyProfileUrl ? (
                        <a href={spotifyProfileUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white/65 transition hover:bg-white/10 hover:text-white">Ver mi perfil <ArrowUpRight className="h-4 w-4" /></a>
                      ) : null}
                    </div>
                  </div>
                )}

                {spotifyError ? <p className="mt-4 text-xs text-rose-300/80">{spotifyError}</p> : null}
              </div>
            </div>
          </article>

          <aside className="rounded-[28px] border border-white/10 bg-white/[0.025] p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/35">CUENTA MUSICAL</p>
                <h2 className="mt-1 text-lg font-bold">Spotify</h2>
              </div>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-[#1ed760]/15 text-[#1ed760]"><Music2 className="h-4.5 w-4.5" /></span>
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-white/8 bg-black/20 p-3.5">
                <div className="flex items-center gap-3">
                  {connection?.avatarUrl ? <img src={connection.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" /> : <span className="grid h-9 w-9 place-items-center rounded-full bg-violet-500/15"><Headphones className="h-4.5 w-4.5 text-violet-300" /></span>}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{connection?.displayName || (connected ? "Spotify conectado" : "Sin conectar")}</p>
                    <p className="mt-0.5 text-[11px] text-white/35">{connected ? "Cuenta vinculada a CLOUVA" : "Conectá tu cuenta"}</p>
                  </div>
                  {connected ? <Check className="h-4 w-4 text-emerald-300" /> : null}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/8 bg-black/20 p-3.5">
                  <Volume2 className="h-4 w-4 text-violet-300" />
                  <p className="mt-2.5 text-[11px] text-white/35">Dispositivo</p>
                  <p className="mt-1 truncate text-sm font-semibold">{playback?.device?.name || "Sin actividad"}</p>
                </div>
                <div className="rounded-2xl border border-white/8 bg-black/20 p-3.5">
                  <Disc3 className="h-4 w-4 text-[#1ed760]" />
                  <p className="mt-2.5 text-[11px] text-white/35">Estado</p>
                  <p className="mt-1 text-sm font-semibold">{playback?.isPlaying ? "Reproduciendo" : playback ? "Pausado" : "En espera"}</p>
                </div>
              </div>
            </div>

            {!connected || !scopesReady ? (
              <button type="button" onClick={() => void connectSpotify()} disabled={connecting || !enabled} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-[#1ed760]/25 bg-[#1ed760]/10 px-4 py-3 text-sm font-semibold text-[#70ee99] transition hover:bg-[#1ed760]/15 disabled:opacity-50">
                {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Headphones className="h-4 w-4" />}
                {connected ? "Actualizar permisos" : "Conectar Spotify"}
              </button>
            ) : null}
          </aside>
        </section>

        <section className="overflow-hidden rounded-[28px] border border-violet-300/12 bg-[#0a0a14] shadow-[0_24px_75px_rgba(0,0,0,0.22)]">
          <div className="flex flex-col gap-4 border-b border-white/8 p-5 md:flex-row md:items-end md:justify-between md:p-6">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-violet-300"><Sparkles className="h-3.5 w-3.5" /> PIPELINE CREATIVO</div>
              <h2 className="mt-2 text-2xl font-black tracking-[-0.03em]">Tus canciones</h2>
              <p className="mt-1 text-sm text-white/40">De la idea al lanzamiento, sin separar tu proceso de tu identidad musical.</p>
            </div>

            <div className="flex w-full gap-2 md:w-auto">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void createTrack();
                }}
                placeholder="Nombre de una nueva canción"
                className="min-w-0 flex-1 rounded-2xl border border-violet-300/15 bg-white/[0.06] px-4 py-3 text-sm text-white shadow-inner outline-none transition placeholder:text-white/40 focus:border-violet-300/45 focus:bg-white/[0.08] md:w-72"
              />
              <button
                type="button"
                onClick={() => void createTrack()}
                disabled={!title.trim() || saving}
                className="inline-flex items-center gap-2 rounded-2xl bg-violet-500 px-4 py-3 text-sm font-bold text-white shadow-[0_10px_28px_rgba(124,58,237,0.24)] transition hover:bg-violet-400 disabled:cursor-not-allowed disabled:bg-violet-500/35 disabled:text-white/45 disabled:shadow-none"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Crear
              </button>
            </div>
          </div>

          <div className="grid gap-px border-b border-white/8 bg-white/5 sm:grid-cols-3 lg:grid-cols-6">
            {STATUS_META.map((item) => (
              <div key={item.value} className="bg-[#0a0a14] px-4 py-3">
                <div className="flex items-center gap-2 text-[11px] text-white/42"><span className={`h-1.5 w-1.5 rounded-full ${item.dot}`} />{item.label}</div>
                <p className="mt-1 text-lg font-black">{counts.get(item.value) || 0}</p>
              </div>
            ))}
          </div>

          <div className="p-4 md:p-5">
            {trackError ? <div className="mb-4 rounded-2xl border border-rose-400/15 bg-rose-400/8 px-4 py-3 text-xs text-rose-200">{trackError}</div> : null}

            {tracksLoading ? (
              <div className="grid min-h-40 place-items-center text-white/35"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : rows.length === 0 ? (
              <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.015] p-6 text-center">
                <div>
                  <Music2 className="mx-auto h-8 w-8 text-violet-300/55" />
                  <h3 className="mt-3 font-bold">Todavía no creaste canciones</h3>
                  <p className="mt-1 text-sm text-white/35">Escribí un título arriba y empezá desde la etapa Idea.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {rows.map((row) => {
                  const currentStatus = (row.status || "idea") as TrackStatus;
                  const currentMeta = STATUS_META.find((item) => item.value === currentStatus) || STATUS_META[0];
                  return (
                    <article key={row.id} className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-white/[0.02] p-4 transition hover:border-violet-400/18 hover:bg-violet-400/[0.035] sm:flex-row sm:items-center">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-500/10 text-violet-300"><Music2 className="h-4.5 w-4.5" /></span>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold">{row.title}</h3>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-white/30">
                          <span className={`h-1.5 w-1.5 rounded-full ${currentMeta.dot}`} />
                          <span>{currentMeta.label}</span>
                          {formatDate(row.created_at) ? <><span>·</span><span>{formatDate(row.created_at)}</span></> : null}
                        </div>
                      </div>
                      <select
                        value={currentStatus}
                        onChange={(event) => void updateStatus(row.id, event.target.value as TrackStatus)}
                        className="rounded-xl border border-white/10 bg-[#11111d] px-3 py-2 text-xs text-white/70 outline-none focus:border-violet-400/35"
                        aria-label={`Estado de ${row.title}`}
                      >
                        {STATUS_META.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </select>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
