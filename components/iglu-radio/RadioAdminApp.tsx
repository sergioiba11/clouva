"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Broadcast, CalendarDays, Cloud, Library, ListMusic, Loader2, Play, Radio, RefreshCw, Trash2, Upload } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { IGLU_RADIO_PATH, IGLU_STUDIO_SLUG, igluRadioRoute } from "@/lib/iglu-radio/routes";

type Section = "overview" | "library" | "playlists" | "schedule" | "infra";
type Track = { id: string; title: string; artist: string; album?: string | null; status: string; file_size: number; storage_path: string; created_at: string };
type PlaylistItem = { id: string; position: number; track: Track | null };
type Playlist = { id: string; name: string; description?: string | null; status: string; shuffle: boolean; repeat: boolean; items?: PlaylistItem[] };
type ScheduleBlock = { id: string; title: string; description?: string | null; kind: string; day_of_week?: number | null; start_time?: string | null; end_time?: string | null; starts_at?: string | null; ends_at?: string | null; timezone: string; status: string; playlist_id?: string | null };
type Overview = {
  permission: { role: string };
  signal: { configured: boolean; reachable: boolean; isLive: boolean; nowPlaying?: { title?: string; artist?: string } | null };
  server: { configured: boolean; controllable: boolean; reachable: boolean };
  settings: { autodj_enabled: boolean; active_playlist_id?: string | null; timezone: string };
  library: { count: number; ready: number; synced: number; bytes: number };
  playlists: Array<{ id: string; name: string; status: string }>;
  schedule: ScheduleBlock[];
};

const ADMIN_API = `/api/studios/${IGLU_STUDIO_SLUG}/radio/admin`;
const NAV: Array<[Section, string, React.ComponentType<{ size?: number }>]> = [
  ["overview", "CONTROL", Radio],
  ["library", "BIBLIOTECA", Library],
  ["playlists", "PLAYLISTS", ListMusic],
  ["schedule", "PROGRAMACIÓN", CalendarDays],
  ["infra", "SERVIDOR", Cloud],
];

function adminHref(section: Section) {
  return section === "overview" ? igluRadioRoute("admin") : igluRadioRoute(`admin/${section}`);
}

function bytesLabel(bytes: number) {
  if (!bytes) return "0 MB";
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function dayLabel(day: number | null | undefined) {
  return ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"][day ?? -1] ?? "FECHA";
}

export function RadioAdminApp({ initialSection = "overview" }: { initialSection?: Section }) {
  const { user, loading: authLoading } = useAuth();
  const section = initialSection;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [schedule, setSchedule] = useState<ScheduleBlock[]>([]);
  const [uploadStage, setUploadStage] = useState<string | null>(null);
  const [draggedTrack, setDraggedTrack] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    const response = await authenticatedFetch(ADMIN_API);
    setOverview(await readApiJson<Overview>(response));
  }, []);

  const loadSection = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      if (section === "overview" || section === "infra") {
        await loadOverview();
      } else if (section === "library") {
        const response = await authenticatedFetch(`${ADMIN_API}/library`);
        const payload = await readApiJson<{ tracks: Track[] }>(response);
        setTracks(payload.tracks);
      } else if (section === "playlists") {
        const [playlistResponse, trackResponse] = await Promise.all([
          authenticatedFetch(`${ADMIN_API}/playlists`),
          authenticatedFetch(`${ADMIN_API}/library`),
        ]);
        setPlaylists((await readApiJson<{ playlists: Playlist[] }>(playlistResponse)).playlists);
        setTracks((await readApiJson<{ tracks: Track[] }>(trackResponse)).tracks);
      } else if (section === "schedule") {
        const [scheduleResponse, playlistResponse] = await Promise.all([
          authenticatedFetch(`${ADMIN_API}/schedule`),
          authenticatedFetch(`${ADMIN_API}/playlists`),
        ]);
        setSchedule((await readApiJson<{ schedule: ScheduleBlock[] }>(scheduleResponse)).schedule);
        setPlaylists((await readApiJson<{ playlists: Playlist[] }>(playlistResponse)).playlists);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar IGLÚ RADIO Admin.");
    } finally {
      setLoading(false);
    }
  }, [loadOverview, section, user]);

  useEffect(() => { void loadSection(); }, [loadSection]);

  const sortedPlaylists = useMemo(() => playlists.map((playlist) => ({
    ...playlist,
    items: [...(playlist.items ?? [])].sort((a, b) => a.position - b.position),
  })), [playlists]);

  if (authLoading) return <AdminState title="CARGANDO SESIÓN" />;
  if (!user) {
    return (
      <AdminState title="ACCESO PRIVADO" text="Iniciá sesión con una cuenta autorizada para administrar El Iglú.">
        <Link href={`/login?next=${encodeURIComponent(igluRadioRoute("admin"))}`} className="rounded-full bg-cyan-300 px-5 py-3 text-xs font-black tracking-[.14em] text-[#02070b]">INICIAR SESIÓN</Link>
      </AdminState>
    );
  }

  return (
    <section className="relative mx-auto min-h-[calc(100dvh-72px)] max-w-[1440px] px-3 pb-32 pt-5 text-white sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={IGLU_RADIO_PATH} className="inline-flex items-center gap-2 text-[10px] font-bold tracking-[.18em] text-cyan-100/55 hover:text-cyan-100"><ArrowLeft size={14} /> VOLVER A LA RADIO</Link>
          <p className="mt-4 text-[10px] font-black tracking-[.25em] text-cyan-300">EL IGLÚ · CONTROL ROOM</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">IGLÚ RADIO ADMIN</h1>
        </div>
        <button onClick={() => void loadSection()} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-cyan-100/15 bg-cyan-100/[.04] px-4 text-xs font-bold text-cyan-50"><RefreshCw size={15} /> ACTUALIZAR</button>
      </div>

      <nav className="mb-6 flex gap-2 overflow-x-auto pb-2">
        {NAV.map(([key, label, Icon]) => (
          <Link key={key} href={adminHref(key)} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-[10px] font-black tracking-[.12em] ${section === key ? "border-cyan-300/50 bg-cyan-300 text-[#02070b]" : "border-cyan-100/10 bg-white/[.025] text-cyan-50/65"}`}>
            <Icon size={15} /> {label}
          </Link>
        ))}
      </nav>

      {error ? <div className="mb-5 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-100">{error}</div> : null}
      {notice ? <div className="mb-5 rounded-2xl border border-cyan-300/25 bg-cyan-300/10 p-4 text-sm text-cyan-50">{notice}</div> : null}
      {loading ? <AdminState title="SINCRONIZANDO CONTROL" compact /> : null}

      {!loading && section === "overview" && overview ? (
        <OverviewPanel overview={overview} onToggleAutoDj={async (enabled) => {
          setError(null); setNotice(null);
          try {
            const response = await authenticatedFetch(`${ADMIN_API}/settings/autodj`, { method: "POST", body: JSON.stringify({ enabled }) });
            await readApiJson(response);
            setNotice(enabled ? "AutoDJ iniciado." : "AutoDJ detenido.");
            await loadOverview();
          } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo cambiar AutoDJ."); }
        }} />
      ) : null}

      {!loading && section === "infra" && overview ? <InfraPanel overview={overview} /> : null}
      {!loading && section === "library" ? (
        <LibraryPanel tracks={tracks} uploadStage={uploadStage} onUpload={async (file, meta) => {
          setError(null); setNotice(null); setUploadStage("PREPARANDO UPLOAD");
          try {
            const prepared = await readApiJson<{ track: Track; upload: { bucket: string; path: string; token: string } }>(await authenticatedFetch(`${ADMIN_API}/library/upload-url`, {
              method: "POST",
              body: JSON.stringify({ filename: file.name, mimeType: file.type, fileSize: file.size, ...meta }),
            }));
            setUploadStage("SUBIENDO A CLOUVA STORAGE");
            const { supabase } = await import("@/lib/supabase");
            const upload = await supabase.storage.from(prepared.upload.bucket).uploadToSignedUrl(prepared.upload.path, prepared.upload.token, file, { contentType: file.type });
            if (upload.error) throw upload.error;
            setUploadStage("REGISTRANDO EN BIBLIOTECA");
            await readApiJson(await authenticatedFetch(`${ADMIN_API}/library/complete`, { method: "POST", body: JSON.stringify({ trackId: prepared.track.id }) }));
            setNotice("Archivo cargado en la biblioteca de IGLÚ RADIO.");
            const refreshed = await readApiJson<{ tracks: Track[] }>(await authenticatedFetch(`${ADMIN_API}/library`));
            setTracks(refreshed.tracks);
          } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo subir el archivo."); }
          finally { setUploadStage(null); }
        }} onDelete={async (id) => {
          if (!confirm("¿Eliminar este track de la biblioteca?")) return;
          try {
            await readApiJson(await authenticatedFetch(`${ADMIN_API}/library/${id}`, { method: "DELETE" }));
            setTracks((current) => current.filter((track) => track.id !== id));
          } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo eliminar."); }
        }} />
      ) : null}

      {!loading && section === "playlists" ? (
        <PlaylistsPanel playlists={sortedPlaylists} tracks={tracks} draggedTrack={draggedTrack} setDraggedTrack={setDraggedTrack} reload={loadSection} setError={setError} setNotice={setNotice} />
      ) : null}

      {!loading && section === "schedule" ? (
        <SchedulePanel schedule={schedule} playlists={playlists} reload={loadSection} setError={setError} />
      ) : null}
    </section>
  );
}

function AdminState({ title, text, compact = false, children }: { title: string; text?: string; compact?: boolean; children?: React.ReactNode }) {
  return <div className={`${compact ? "min-h-52" : "min-h-[70dvh]"} grid place-items-center px-5 text-center`}><div><Loader2 className="mx-auto mb-4 animate-spin text-cyan-300" /><h2 className="text-lg font-black tracking-[.12em]">{title}</h2>{text ? <p className="mx-auto mt-3 max-w-md text-sm text-white/55">{text}</p> : null}{children ? <div className="mt-5">{children}</div> : null}</div></div>;
}

function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <article className="rounded-[24px] border border-cyan-100/10 bg-[#06101a]/75 p-5"><p className="text-[10px] font-black tracking-[.18em] text-cyan-200/55">{label}</p><strong className="mt-2 block text-2xl font-black">{value}</strong>{detail ? <p className="mt-2 text-xs text-white/45">{detail}</p> : null}</article>;
}

function OverviewPanel({ overview, onToggleAutoDj }: { overview: Overview; onToggleAutoDj: (enabled: boolean) => Promise<void> }) {
  const signal = overview.signal;
  const status = signal.isLive ? "LIVE" : overview.settings.autodj_enabled ? "AUTODJ" : signal.reachable ? "SEÑAL LISTA" : "OFFLINE";
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="SEÑAL" value={status} detail={signal.nowPlaying ? `${signal.nowPlaying.artist ?? ""} · ${signal.nowPlaying.title ?? ""}` : "Sin metadata actual"} />
      <StatCard label="BIBLIOTECA" value={`${overview.library.count} TRACKS`} detail={`${bytesLabel(overview.library.bytes)} · ${overview.library.synced} sincronizados`} />
      <StatCard label="PLAYLISTS" value={String(overview.playlists.length)} detail={overview.settings.active_playlist_id ? "Playlist activa seleccionada" : "Sin playlist activa"} />
      <StatCard label="SERVIDOR" value={overview.server.reachable ? "ONLINE" : overview.server.configured ? "SIN RESPUESTA" : "PENDIENTE"} detail={overview.server.controllable ? "Control API habilitado" : "Falta API privada"} />
    </div>
    <article className="rounded-[28px] border border-cyan-100/10 bg-black/35 p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-[10px] font-black tracking-[.2em] text-cyan-300">AUTO DJ 24/7</p><h2 className="mt-1 text-xl font-black">{overview.settings.autodj_enabled ? "TRANSMISIÓN AUTOMÁTICA ACTIVA" : "AUTO DJ DETENIDO"}</h2><p className="mt-2 max-w-2xl text-sm text-white/50">CLOUVA solo permite encenderlo cuando exista servidor AzuraCast, playlist activa y audio sincronizado.</p></div><button onClick={() => void onToggleAutoDj(!overview.settings.autodj_enabled)} className={`inline-flex min-h-12 items-center gap-2 rounded-full px-5 text-xs font-black tracking-[.12em] ${overview.settings.autodj_enabled ? "border border-white/15 bg-white/5" : "bg-cyan-300 text-[#02070b]"}`}><Play size={16} /> {overview.settings.autodj_enabled ? "DETENER AUTODJ" : "ACTIVAR AUTODJ"}</button></div>
    </article>
  </div>;
}

function LibraryPanel({ tracks, uploadStage, onUpload, onDelete }: { tracks: Track[]; uploadStage: string | null; onUpload: (file: File, meta: Record<string, string>) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null); const [title, setTitle] = useState(""); const [artist, setArtist] = useState("");
  return <div className="space-y-5">
    <form onSubmit={(event) => { event.preventDefault(); if (file) void onUpload(file, { title, artist }); }} className="rounded-[28px] border border-cyan-300/15 bg-cyan-300/[.035] p-5 sm:p-7">
      <p className="text-[10px] font-black tracking-[.2em] text-cyan-300">+ SUBIR MÚSICA</p><div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_1.2fr_auto]"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" className="min-h-12 rounded-xl border border-white/10 bg-black/35 px-4 text-sm outline-none focus:border-cyan-300/50" /><input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artista" className="min-h-12 rounded-xl border border-white/10 bg-black/35 px-4 text-sm outline-none focus:border-cyan-300/50" /><label className="flex min-h-12 cursor-pointer items-center rounded-xl border border-dashed border-cyan-200/25 bg-black/25 px-4 text-xs text-white/60"><input type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/x-flac" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />{file ? file.name : "MP3 · WAV · FLAC"}</label><button disabled={!file || Boolean(uploadStage)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 text-xs font-black text-[#02070b] disabled:opacity-40"><Upload size={16} /> {uploadStage ?? "SUBIR"}</button></div>
    </form>
    <div className="space-y-2">{tracks.length ? tracks.map((track) => <article key={track.id} className="flex items-center gap-4 rounded-2xl border border-white/8 bg-black/30 p-4"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-cyan-300/10"><Radio size={18} /></div><div className="min-w-0 flex-1"><strong className="block truncate">{track.title}</strong><p className="truncate text-xs text-white/45">{track.artist} · {bytesLabel(track.file_size)}</p></div><span className={`rounded-full border px-3 py-1 text-[9px] font-black tracking-[.12em] ${track.status === "synced" ? "border-emerald-300/30 text-emerald-200" : "border-cyan-100/15 text-cyan-100/60"}`}>{track.status.toUpperCase()}</span><button onClick={() => void onDelete(track.id)} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-white/45 hover:text-red-200"><Trash2 size={15} /></button></article>) : <Empty text="Todavía no hay audio cargado." />}</div>
  </div>;
}

function PlaylistsPanel({ playlists, tracks, draggedTrack, setDraggedTrack, reload, setError, setNotice }: { playlists: Playlist[]; tracks: Track[]; draggedTrack: string | null; setDraggedTrack: (id: string | null) => void; reload: () => Promise<void>; setError: (v: string | null) => void; setNotice: (v: string | null) => void }) {
  const [name, setName] = useState("");
  const call = async (url: string, init: RequestInit = {}) => readApiJson(await authenticatedFetch(url, init));
  return <div className="space-y-5"><form onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; try { await call(`${ADMIN_API}/playlists`, { method: "POST", body: JSON.stringify({ name }) }); setName(""); await reload(); } catch (c) { setError(c instanceof Error ? c.message : "No se pudo crear."); } }} className="flex gap-2"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nueva playlist" className="min-h-12 flex-1 rounded-xl border border-white/10 bg-black/35 px-4 text-sm" /><button className="rounded-xl bg-cyan-300 px-5 text-xs font-black text-[#02070b]">CREAR</button></form>{playlists.length ? playlists.map((playlist) => <article key={playlist.id} className="rounded-[24px] border border-white/10 bg-black/30 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-black tracking-[.16em] text-cyan-300">{playlist.status.toUpperCase()}</p><h3 className="text-xl font-black">{playlist.name}</h3></div><button onClick={async () => { try { await call(`${ADMIN_API}/playlists/${playlist.id}/activate`, { method: "POST", body: "{}" }); setNotice("Playlist activa actualizada."); await reload(); } catch (c) { setError(c instanceof Error ? c.message : "No se pudo activar."); } }} className="rounded-full border border-cyan-300/25 px-4 py-2 text-[10px] font-black text-cyan-200">ACTIVAR</button></div><div className="mt-4 flex gap-2"><select id={`track-${playlist.id}`} className="min-h-11 flex-1 rounded-xl border border-white/10 bg-[#07111b] px-3 text-sm"><option value="">Agregar track...</option>{tracks.filter((t) => t.status !== "archived").map((track) => <option key={track.id} value={track.id}>{track.artist} — {track.title}</option>)}</select><button onClick={async () => { const select = document.getElementById(`track-${playlist.id}`) as HTMLSelectElement | null; if (!select?.value) return; try { await call(`${ADMIN_API}/playlists/${playlist.id}/items`, { method: "POST", body: JSON.stringify({ trackId: select.value }) }); await reload(); } catch (c) { setError(c instanceof Error ? c.message : "No se pudo agregar."); } }} className="rounded-xl border border-white/10 px-4 text-xs font-bold">AGREGAR</button></div><div className="mt-4 space-y-2">{(playlist.items ?? []).map((item) => item.track ? <div key={item.id} draggable onDragStart={() => setDraggedTrack(item.track!.id)} onDragOver={(e) => e.preventDefault()} onDrop={async () => { if (!draggedTrack || draggedTrack === item.track!.id) return; const ids = (playlist.items ?? []).map((x) => x.track?.id).filter(Boolean) as string[]; const from = ids.indexOf(draggedTrack); const to = ids.indexOf(item.track!.id); if (from < 0 || to < 0) return; ids.splice(to, 0, ids.splice(from, 1)[0]); try { await call(`${ADMIN_API}/playlists/${playlist.id}/reorder`, { method: "POST", body: JSON.stringify({ trackIds: ids }) }); await reload(); } catch (c) { setError(c instanceof Error ? c.message : "No se pudo reordenar."); } finally { setDraggedTrack(null); } }} className="flex cursor-grab items-center gap-3 rounded-xl border border-white/8 bg-white/[.025] p-3"><span className="w-6 text-xs text-white/30">{item.position + 1}</span><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{item.track.title}</strong><span className="text-xs text-white/40">{item.track.artist}</span></div></div> : null)}</div></article>) : <Empty text="Creá la primera playlist de IGLÚ RADIO." />}</div>;
}

function SchedulePanel({ schedule, playlists, reload, setError }: { schedule: ScheduleBlock[]; playlists: Playlist[]; reload: () => Promise<void>; setError: (v: string | null) => void }) {
  const [title, setTitle] = useState(""); const [day, setDay] = useState("1"); const [start, setStart] = useState("20:00"); const [playlistId, setPlaylistId] = useState("");
  return <div className="space-y-5"><form onSubmit={async (e) => { e.preventDefault(); try { await readApiJson(await authenticatedFetch(`${ADMIN_API}/schedule`, { method: "POST", body: JSON.stringify({ title, dayOfWeek: Number(day), startTime: start, playlistId: playlistId || null, kind: "autodj" }) })); setTitle(""); await reload(); } catch (c) { setError(c instanceof Error ? c.message : "No se pudo programar."); } }} className="grid gap-3 rounded-[24px] border border-cyan-100/10 bg-black/30 p-5 md:grid-cols-[1.4fr_.7fr_.7fr_1fr_auto]"><input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nombre del bloque" className="min-h-12 rounded-xl border border-white/10 bg-black/35 px-3 text-sm" /><select value={day} onChange={(e) => setDay(e.target.value)} className="min-h-12 rounded-xl border border-white/10 bg-[#07111b] px-3 text-sm">{["DOM","LUN","MAR","MIÉ","JUE","VIE","SÁB"].map((label, i) => <option key={label} value={i}>{label}</option>)}</select><input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="min-h-12 rounded-xl border border-white/10 bg-[#07111b] px-3 text-sm" /><select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)} className="min-h-12 rounded-xl border border-white/10 bg-[#07111b] px-3 text-sm"><option value="">Sin playlist</option>{playlists.filter((p) => p.status !== "archived").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="rounded-xl bg-cyan-300 px-5 text-xs font-black text-[#02070b]">PROGRAMAR</button></form><div className="space-y-2">{schedule.length ? schedule.map((block) => <article key={block.id} className="flex items-center gap-4 rounded-2xl border border-white/8 bg-black/30 p-4"><div className="w-16 text-center"><strong className="block text-cyan-200">{dayLabel(block.day_of_week)}</strong><span className="text-xs text-white/45">{block.start_time?.slice(0,5) ?? "FECHA"}</span></div><div className="min-w-0 flex-1"><strong className="block truncate">{block.title}</strong><p className="text-xs text-white/40">{block.kind.toUpperCase()} · {block.timezone}</p></div><button onClick={async () => { try { await readApiJson(await authenticatedFetch(`${ADMIN_API}/schedule/${block.id}`, { method: "DELETE" })); await reload(); } catch (c) { setError(c instanceof Error ? c.message : "No se pudo borrar."); } }} className="grid h-10 w-10 place-items-center rounded-full border border-white/10 text-white/45"><Trash2 size={15} /></button></article>) : <Empty text="Todavía no hay bloques publicados." />}</div></div>;
}

function InfraPanel({ overview }: { overview: Overview }) {
  return <div className="grid gap-4 lg:grid-cols-2"><article className="rounded-[26px] border border-cyan-100/10 bg-black/35 p-6"><Broadcast className="text-cyan-300" /><h2 className="mt-4 text-xl font-black">AZURACAST / ICECAST</h2><p className="mt-2 text-sm text-white/50">{overview.server.configured ? overview.server.reachable ? "Servidor configurado y respondiendo." : "Configurado pero sin respuesta." : "Pendiente de crear la VM radial y conectar radio.clouva.com.ar."}</p><div className="mt-5 space-y-2 text-xs text-white/60"><p>API privada: <strong>{overview.server.controllable ? "CONFIGURADA" : "PENDIENTE"}</strong></p><p>AutoDJ: <strong>{overview.settings.autodj_enabled ? "ACTIVO" : "DETENIDO"}</strong></p><p>Timezone: <strong>{overview.settings.timezone}</strong></p></div></article><article className="rounded-[26px] border border-cyan-100/10 bg-black/35 p-6"><Cloud className="text-cyan-300" /><h2 className="mt-4 text-xl font-black">SIGUIENTE DEPENDENCIA</h2><p className="mt-2 text-sm leading-6 text-white/50">El plano de control de CLOUVA ya distingue servidor pendiente de transmisión real. Para emitir 24/7 falta provisionar Compute Engine + AzuraCast, DNS/SSL y sincronizar la biblioteca con Media Manager.</p><a href="https://radio.clouva.com.ar" target="_blank" rel="noreferrer" className="mt-5 inline-flex text-xs font-black tracking-[.12em] text-cyan-300">RADIO.CLOUVA.COM.AR ↗</a></article></div>;
}

function Empty({ text }: { text: string }) { return <div className="rounded-[22px] border border-dashed border-cyan-100/15 p-8 text-center text-sm text-white/40">{text}</div>; }
