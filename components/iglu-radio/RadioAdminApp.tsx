"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CalendarDays, Cloud, Library, ListMusic, Loader2, Play, Radio, RefreshCw, Trash2, Upload } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { IGLU_RADIO_PATH, IGLU_STUDIO_SLUG, igluRadioRoute } from "@/lib/iglu-radio/routes";

type Section = "overview" | "library" | "playlists" | "schedule" | "infra";
type Track = { id: string; title: string; artist: string; status: string; file_size: number };
type PlaylistItem = { id: string; position: number; track: Track | null };
type Playlist = { id: string; name: string; status: string; items?: PlaylistItem[] };
type ScheduleBlock = { id: string; title: string; kind: string; day_of_week?: number | null; start_time?: string | null; timezone: string; status: string };
type Overview = {
  signal: { reachable: boolean; isLive: boolean; nowPlaying?: { title?: string; artist?: string } | null };
  server: { configured: boolean; controllable: boolean; reachable: boolean };
  settings: { autodj_enabled: boolean; active_playlist_id?: string | null; timezone: string };
  library: { count: number; ready: number; synced: number; bytes: number };
  playlists: Array<{ id: string; name: string; status: string }>;
};

const ADMIN_API = `/api/studios/${IGLU_STUDIO_SLUG}/radio/admin`;
const NAV: Array<{ key: Section; label: string }> = [
  { key: "overview", label: "CONTROL" },
  { key: "library", label: "BIBLIOTECA" },
  { key: "playlists", label: "PLAYLISTS" },
  { key: "schedule", label: "PROGRAMACIÓN" },
  { key: "infra", label: "SERVIDOR" },
];

function adminHref(section: Section) {
  return section === "overview" ? igluRadioRoute("admin") : igluRadioRoute(`admin/${section}`);
}

function bytesLabel(bytes: number) {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function dayLabel(day: number | null | undefined) {
  return ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"][day ?? -1] ?? "FECHA";
}

export function RadioAdminApp({ initialSection = "overview" }: { initialSection?: Section }) {
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [schedule, setSchedule] = useState<ScheduleBlock[]>([]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      if (initialSection === "overview" || initialSection === "infra") {
        setOverview(await readApiJson<Overview>(await authenticatedFetch(ADMIN_API)));
      }
      if (initialSection === "library") {
        const payload = await readApiJson<{ tracks: Track[] }>(await authenticatedFetch(`${ADMIN_API}/library`));
        setTracks(payload.tracks);
      }
      if (initialSection === "playlists") {
        const [p, t] = await Promise.all([
          readApiJson<{ playlists: Playlist[] }>(await authenticatedFetch(`${ADMIN_API}/playlists`)),
          readApiJson<{ tracks: Track[] }>(await authenticatedFetch(`${ADMIN_API}/library`)),
        ]);
        setPlaylists(p.playlists);
        setTracks(t.tracks);
      }
      if (initialSection === "schedule") {
        const [s, p] = await Promise.all([
          readApiJson<{ schedule: ScheduleBlock[] }>(await authenticatedFetch(`${ADMIN_API}/schedule`)),
          readApiJson<{ playlists: Playlist[] }>(await authenticatedFetch(`${ADMIN_API}/playlists`)),
        ]);
        setSchedule(s.schedule);
        setPlaylists(p.playlists);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar IGLÚ RADIO Admin.");
    } finally {
      setLoading(false);
    }
  }, [initialSection, user]);

  useEffect(() => { void load(); }, [load]);

  if (authLoading) return <State title="CARGANDO SESIÓN" />;
  if (!user) {
    return <State title="ACCESO PRIVADO" text="Iniciá sesión con una cuenta autorizada para administrar El Iglú." />;
  }

  return (
    <section className="relative mx-auto min-h-[calc(100dvh-72px)] max-w-[1440px] px-3 pb-32 pt-5 text-white sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={IGLU_RADIO_PATH} className="inline-flex items-center gap-2 text-[10px] font-bold tracking-[.18em] text-cyan-100/55 hover:text-cyan-100"><ArrowLeft size={14} /> VOLVER A LA RADIO</Link>
          <p className="mt-4 text-[10px] font-black tracking-[.25em] text-cyan-300">EL IGLÚ · CONTROL ROOM</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">IGLÚ RADIO ADMIN</h1>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-cyan-100/15 bg-cyan-100/[.04] px-4 text-xs font-bold text-cyan-50"><RefreshCw size={15} /> ACTUALIZAR</button>
      </div>

      <nav className="mb-6 flex gap-2 overflow-x-auto pb-2">
        {NAV.map((item) => <Link key={item.key} href={adminHref(item.key)} className={`min-h-11 shrink-0 rounded-full border px-4 py-3 text-[10px] font-black tracking-[.12em] ${initialSection === item.key ? "border-cyan-300/50 bg-cyan-300 text-[#02070b]" : "border-cyan-100/10 bg-white/[.025] text-cyan-50/65"}`}>{item.label}</Link>)}
      </nav>

      {error ? <div className="mb-5 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-100">{error}</div> : null}
      {notice ? <div className="mb-5 rounded-2xl border border-cyan-300/25 bg-cyan-300/10 p-4 text-sm text-cyan-50">{notice}</div> : null}
      {loading ? <State title="SINCRONIZANDO CONTROL" compact /> : null}

      {!loading && initialSection === "overview" && overview ? <OverviewPanel overview={overview} refresh={load} setError={setError} setNotice={setNotice} /> : null}
      {!loading && initialSection === "library" ? <LibraryPanel tracks={tracks} refresh={load} setError={setError} setNotice={setNotice} /> : null}
      {!loading && initialSection === "playlists" ? <PlaylistsPanel playlists={playlists} tracks={tracks} refresh={load} setError={setError} setNotice={setNotice} /> : null}
      {!loading && initialSection === "schedule" ? <SchedulePanel schedule={schedule} playlists={playlists} refresh={load} setError={setError} /> : null}
      {!loading && initialSection === "infra" && overview ? <InfraPanel overview={overview} /> : null}
    </section>
  );
}

function State({ title, text, compact = false }: { title: string; text?: string; compact?: boolean }) {
  return <div className={`${compact ? "min-h-52" : "min-h-[70dvh]"} grid place-items-center px-5 text-center`}><div><Loader2 className="mx-auto mb-4 animate-spin text-cyan-300" /><h2 className="text-lg font-black tracking-[.12em]">{title}</h2>{text ? <p className="mt-3 text-sm text-white/55">{text}</p> : null}</div></div>;
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <article className="rounded-[24px] border border-cyan-100/10 bg-[#06101a]/75 p-5"><p className="text-[10px] font-black tracking-[.18em] text-cyan-200/55">{label}</p><strong className="mt-2 block text-2xl font-black">{value}</strong>{detail ? <p className="mt-2 text-xs text-white/45">{detail}</p> : null}</article>;
}

function OverviewPanel({ overview, refresh, setError, setNotice }: { overview: Overview; refresh: () => Promise<void>; setError: (v: string | null) => void; setNotice: (v: string | null) => void }) {
  const status = overview.signal.isLive ? "LIVE" : overview.settings.autodj_enabled ? "AUTODJ" : overview.signal.reachable ? "SEÑAL LISTA" : "OFFLINE";
  const toggle = async () => {
    try {
      setError(null);
      const enabled = !overview.settings.autodj_enabled;
      await readApiJson(await authenticatedFetch(`${ADMIN_API}/settings/autodj`, { method: "POST", body: JSON.stringify({ enabled }) }));
      setNotice(enabled ? "AutoDJ iniciado." : "AutoDJ detenido.");
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cambiar AutoDJ."); }
  };
  return <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="SEÑAL" value={status} detail={overview.signal.nowPlaying ? `${overview.signal.nowPlaying.artist ?? ""} · ${overview.signal.nowPlaying.title ?? ""}` : "Sin metadata actual"} /><Stat label="BIBLIOTECA" value={`${overview.library.count} TRACKS`} detail={`${bytesLabel(overview.library.bytes)} · ${overview.library.synced} sincronizados`} /><Stat label="PLAYLISTS" value={String(overview.playlists.length)} detail={overview.settings.active_playlist_id ? "Playlist activa" : "Sin playlist activa"} /><Stat label="SERVIDOR" value={overview.server.reachable ? "ONLINE" : overview.server.configured ? "SIN RESPUESTA" : "PENDIENTE"} detail={overview.server.controllable ? "API privada configurada" : "Falta API privada"} /></div><article className="rounded-[28px] border border-cyan-100/10 bg-black/35 p-6"><p className="text-[10px] font-black tracking-[.2em] text-cyan-300">AUTO DJ 24/7</p><div className="mt-3 flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-xl font-black">{overview.settings.autodj_enabled ? "TRANSMISIÓN AUTOMÁTICA ACTIVA" : "AUTO DJ DETENIDO"}</h2><p className="mt-2 text-sm text-white/50">Requiere playlist activa, servidor radial y audio sincronizado.</p></div><button type="button" onClick={() => void toggle()} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-cyan-300 px-5 text-xs font-black text-[#02070b]"><Play size={16} /> {overview.settings.autodj_enabled ? "DETENER" : "ACTIVAR AUTODJ"}</button></div></article></div>;
}

function LibraryPanel({ tracks, refresh, setError, setNotice }: { tracks: Track[]; refresh: () => Promise<void>; setError: (v: string | null) => void; setNotice: (v: string | null) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [uploading, setUploading] = useState(false);
  const upload = async () => {
    if (!file) return;
    setUploading(true); setError(null);
    try {
      const prepared = await readApiJson<{ track: Track; upload: { bucket: string; path: string; token: string } }>(await authenticatedFetch(`${ADMIN_API}/library/upload-url`, { method: "POST", body: JSON.stringify({ filename: file.name, mimeType: file.type, fileSize: file.size, title, artist }) }));
      const { supabase } = await import("@/lib/supabase");
      const result = await supabase.storage.from(prepared.upload.bucket).uploadToSignedUrl(prepared.upload.path, prepared.upload.token, file, { contentType: file.type });
      if (result.error) throw result.error;
      await readApiJson(await authenticatedFetch(`${ADMIN_API}/library/complete`, { method: "POST", body: JSON.stringify({ trackId: prepared.track.id }) }));
      setNotice("Audio cargado en IGLÚ RADIO."); setFile(null); setTitle(""); setArtist(""); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo subir el audio."); } finally { setUploading(false); }
  };
  return <div className="space-y-5"><article className="rounded-[26px] border border-cyan-300/15 bg-cyan-300/[.035] p-5"><div className="flex items-center gap-2 text-cyan-300"><Upload size={16} /><strong className="text-xs tracking-[.14em]">SUBIR MÚSICA</strong></div><div className="mt-4 grid gap-3 md:grid-cols-4"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" className="min-h-12 rounded-xl border border-white/10 bg-black/35 px-3 text-sm" /><input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artista" className="min-h-12 rounded-xl border border-white/10 bg-black/35 px-3 text-sm" /><label className="flex min-h-12 cursor-pointer items-center rounded-xl border border-dashed border-white/15 px-3 text-xs text-white/55"><input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/x-flac" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />{file?.name ?? "MP3 · WAV · FLAC"}</label><button type="button" disabled={!file || uploading} onClick={() => void upload()} className="rounded-xl bg-cyan-300 px-4 text-xs font-black text-[#02070b] disabled:opacity-40">{uploading ? "SUBIENDO..." : "SUBIR"}</button></div></article><div className="space-y-2">{tracks.length ? tracks.map((track) => <article key={track.id} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/30 p-4"><Library size={18} className="text-cyan-300" /><div className="min-w-0 flex-1"><strong className="block truncate">{track.title}</strong><p className="text-xs text-white/45">{track.artist} · {bytesLabel(track.file_size)}</p></div><span className="text-[10px] font-black text-cyan-100/55">{track.status.toUpperCase()}</span><button type="button" onClick={async () => { try { await readApiJson(await authenticatedFetch(`${ADMIN_API}/library/${track.id}`, { method: "DELETE" })); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo borrar."); } }} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-white/45"><Trash2 size={15} /></button></article>) : <Empty text="Todavía no hay audio cargado." />}</div></div>;
}

function PlaylistsPanel({ playlists, tracks, refresh, setError, setNotice }: { playlists: Playlist[]; tracks: Track[]; refresh: () => Promise<void>; setError: (v: string | null) => void; setNotice: (v: string | null) => void }) {
  const [name, setName] = useState("");
  return <div className="space-y-5"><form onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; try { await readApiJson(await authenticatedFetch(`${ADMIN_API}/playlists`, { method: "POST", body: JSON.stringify({ name }) })); setName(""); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo crear."); } }} className="flex gap-2"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nueva playlist" className="min-h-12 flex-1 rounded-xl border border-white/10 bg-black/35 px-4 text-sm" /><button className="rounded-xl bg-cyan-300 px-5 text-xs font-black text-[#02070b]">CREAR</button></form>{playlists.length ? playlists.map((playlist) => <article key={playlist.id} className="rounded-[24px] border border-white/10 bg-black/30 p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black tracking-[.14em] text-cyan-300">{playlist.status.toUpperCase()}</p><h3 className="text-xl font-black">{playlist.name}</h3></div><button type="button" onClick={async () => { try { await readApiJson(await authenticatedFetch(`${ADMIN_API}/playlists/${playlist.id}/activate`, { method: "POST", body: "{}" })); setNotice("Playlist activa actualizada."); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo activar."); } }} className="rounded-full border border-cyan-300/25 px-4 py-2 text-[10px] font-black text-cyan-200">ACTIVAR</button></div><div className="mt-4 flex gap-2"><select id={`track-${playlist.id}`} className="min-h-11 flex-1 rounded-xl border border-white/10 bg-[#07111b] px-3 text-sm"><option value="">Agregar track...</option>{tracks.filter((track) => track.status !== "archived").map((track) => <option key={track.id} value={track.id}>{track.artist} — {track.title}</option>)}</select><button type="button" onClick={async () => { const select = document.getElementById(`track-${playlist.id}`) as HTMLSelectElement | null; if (!select?.value) return; try { await readApiJson(await authenticatedFetch(`${ADMIN_API}/playlists/${playlist.id}/items`, { method: "POST", body: JSON.stringify({ trackId: select.value }) })); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo agregar."); } }} className="rounded-xl border border-white/10 px-4 text-xs font-bold">AGREGAR</button></div><div className="mt-4 space-y-2">{(playlist.items ?? []).map((item) => item.track ? <div key={item.id} className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[.025] p-3"><ListMusic size={15} className="text-cyan-300" /><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{item.track.title}</strong><span className="text-xs text-white/40">{item.track.artist}</span></div></div> : null)}</div></article>) : <Empty text="Creá la primera playlist de IGLÚ RADIO." />}</div>;
}

function SchedulePanel({ schedule, playlists, refresh, setError }: { schedule: ScheduleBlock[]; playlists: Playlist[]; refresh: () => Promise<void>; setError: (v: string | null) => void }) {
  const [title, setTitle] = useState(""); const [day, setDay] = useState("1"); const [start, setStart] = useState("20:00"); const [playlistId, setPlaylistId] = useState("");
  return <div className="space-y-5"><form onSubmit={async (e) => { e.preventDefault(); try { await readApiJson(await authenticatedFetch(`${ADMIN_API}/schedule`, { method: "POST", body: JSON.stringify({ title, dayOfWeek: Number(day), startTime: start, playlistId: playlistId || null, kind: "autodj" }) })); setTitle(""); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo programar."); } }} className="grid gap-3 rounded-[24px] border border-cyan-100/10 bg-black/30 p-5 md:grid-cols-[1.4fr_.7fr_.7fr_1fr_auto]"><input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nombre del bloque" className="min-h-12 rounded-xl border border-white/10 bg-black/35 px-3 text-sm" /><select value={day} onChange={(e) => setDay(e.target.value)} className="min-h-12 rounded-xl border border-white/10 bg-[#07111b] px-3 text-sm">{["DOM","LUN","MAR","MIÉ","JUE","VIE","SÁB"].map((label, index) => <option key={label} value={index}>{label}</option>)}</select><input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="min-h-12 rounded-xl border border-white/10 bg-[#07111b] px-3 text-sm" /><select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)} className="min-h-12 rounded-xl border border-white/10 bg-[#07111b] px-3 text-sm"><option value="">Sin playlist</option>{playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}</select><button className="rounded-xl bg-cyan-300 px-5 text-xs font-black text-[#02070b]">PROGRAMAR</button></form><div className="space-y-2">{schedule.length ? schedule.map((block) => <article key={block.id} className="flex items-center gap-4 rounded-2xl border border-white/10 bg-black/30 p-4"><CalendarDays size={18} className="text-cyan-300" /><div className="w-14"><strong className="block text-cyan-200">{dayLabel(block.day_of_week)}</strong><span className="text-xs text-white/45">{block.start_time?.slice(0, 5) ?? "FECHA"}</span></div><div className="min-w-0 flex-1"><strong className="block truncate">{block.title}</strong><p className="text-xs text-white/40">{block.kind.toUpperCase()} · {block.timezone}</p></div><button type="button" onClick={async () => { try { await readApiJson(await authenticatedFetch(`${ADMIN_API}/schedule/${block.id}`, { method: "DELETE" })); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo borrar."); } }} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-white/45"><Trash2 size={15} /></button></article>) : <Empty text="Todavía no hay bloques publicados." />}</div></div>;
}

function InfraPanel({ overview }: { overview: Overview }) {
  return <div className="grid gap-4 lg:grid-cols-2"><article className="rounded-[26px] border border-cyan-100/10 bg-black/35 p-6"><Radio className="text-cyan-300" /><h2 className="mt-4 text-xl font-black">AZURACAST / ICECAST</h2><p className="mt-2 text-sm text-white/50">{overview.server.configured ? overview.server.reachable ? "Servidor configurado y respondiendo." : "Configurado pero sin respuesta." : "Pendiente de crear la VM radial y conectar radio.clouva.com.ar."}</p><div className="mt-5 space-y-2 text-xs text-white/60"><p>API privada: <strong>{overview.server.controllable ? "CONFIGURADA" : "PENDIENTE"}</strong></p><p>AutoDJ: <strong>{overview.settings.autodj_enabled ? "ACTIVO" : "DETENIDO"}</strong></p><p>Timezone: <strong>{overview.settings.timezone}</strong></p></div></article><article className="rounded-[26px] border border-cyan-100/10 bg-black/35 p-6"><Cloud className="text-cyan-300" /><h2 className="mt-4 text-xl font-black">SIGUIENTE DEPENDENCIA</h2><p className="mt-2 text-sm leading-6 text-white/50">Para emitir 24/7 falta provisionar Compute Engine + AzuraCast, DNS/SSL y sincronizar la biblioteca con Media Manager.</p></article></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-[22px] border border-dashed border-cyan-100/15 p-8 text-center text-sm text-white/40">{text}</div>;
}
