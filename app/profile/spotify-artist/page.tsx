"use client";

import Link from "next/link";
import {
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  Music2,
  RefreshCw,
  Search,
  Unlink,
  UserRoundCheck,
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type ArtistPayload = {
  id: string;
  name: string;
  url: string;
  imageUrl: string | null;
  genres?: string[];
  matchedTrack?: { id: string; name: string; url: string | null } | null;
};

type ReleasePayload = {
  id: string;
  name: string;
  type: string | null;
  releaseDate: string | null;
  totalTracks: number | null;
  url: string;
  imageUrl: string | null;
};

type ArtistData = {
  source?: "web_api" | "oembed";
  artist?: ArtistPayload;
  releases?: ReleasePayload[];
  syncedAt?: string;
};

type PlayerSpotify = {
  id: string;
  slug: string;
  display_name: string;
  spotify_artist_id?: string | null;
  spotify_profile_url: string | null;
  spotify_sync_status?: string | null;
  spotify_last_sync_at?: string | null;
  spotify_for_artists_id?: string | null;
  spotify_for_artists_url?: string | null;
  spotify_for_artists_status?: string | null;
  spotify_for_artists_last_import_at?: string | null;
  spotify_artist_data?: ArtistData | null;
};

type SpotifyAccount = {
  connected: boolean;
  displayName?: string | null;
  avatarUrl?: string | null;
  status?: string | null;
  scopes?: string[];
};

type ImportSummary = {
  id: string;
  source_type: string;
  file_name: string;
  row_count: number;
  imported_at: string;
  headers?: string[];
};

type SearchMode = "artist" | "track";

export default function SpotifyArtistConnectPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [player, setPlayer] = useState<PlayerSpotify | null>(null);
  const [spotifyAccount, setSpotifyAccount] = useState<SpotifyAccount | null>(null);
  const [workspaceUrl, setWorkspaceUrl] = useState("");
  const [artistUrl, setArtistUrl] = useState("");
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("artist");
  const [results, setResults] = useState<ArtistPayload[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [imports, setImports] = useState<ImportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, router, user]);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [playerResponse, statusResponse, importResponse] = await Promise.all([
        authenticatedFetch("/api/players/me"),
        authenticatedFetch("/api/integrations/spotify/status"),
        authenticatedFetch("/api/integrations/spotify/artist-import"),
      ]);
      const playerPayload = await readApiJson<{ player: PlayerSpotify | null }>(playerResponse);
      if (!playerPayload.player) {
        router.replace("/onboarding/identity");
        return;
      }
      const statusPayload = await readApiJson<{ connection?: SpotifyAccount }>(statusResponse);
      const importPayload = importResponse.ok
        ? await readApiJson<{ imports?: ImportSummary[] }>(importResponse)
        : { imports: [] };

      setPlayer(playerPayload.player);
      setSpotifyAccount(statusPayload.connection || { connected: false });
      setImports(importPayload.imports || []);
      setWorkspaceUrl(playerPayload.player.spotify_for_artists_url || "");
      setArtistUrl(playerPayload.player.spotify_profile_url || "");
      setQuery(playerPayload.player.display_name || "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar Spotify.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const connectSpotifyAccount = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/integrations/spotify/connect", {
        method: "POST",
        body: JSON.stringify({ returnPath: "/profile/spotify-artist" }),
      });
      const payload = await readApiJson<{ authorizeUrl: string }>(response);
      window.location.assign(payload.authorizeUrl);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "No se pudo iniciar sesión con Spotify.");
      setSaving(false);
    }
  };

  const connectWorkspace = async () => {
    if (!workspaceUrl.trim()) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/integrations/spotify/artist-link", {
        method: "POST",
        body: JSON.stringify({
          forArtistsUrl: workspaceUrl.trim(),
          connectionKind: "for_artists_workspace",
        }),
      });
      const payload = await readApiJson<{
        player: PlayerSpotify;
        publicArtistLinked: boolean;
        artist: ArtistPayload | null;
      }>(response);
      setPlayer(payload.player);
      setWorkspaceUrl(payload.player.spotify_for_artists_url || workspaceUrl);
      if (payload.artist?.url) setArtistUrl(payload.artist.url);
      setMessage(payload.publicArtistLinked
        ? "Spotify for Artists y tu perfil público quedaron vinculados."
        : "Spotify for Artists quedó asociado a tu Player. Ahora elegí el perfil público correcto para activar música y catálogo.");
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "No se pudo vincular Spotify for Artists.");
    } finally {
      setSaving(false);
    }
  };

  const searchArtists = async (options?: { append?: boolean; mode?: SearchMode }) => {
    const mode = options?.mode || searchMode;
    if (query.trim().length < 2) return;
    const offset = options?.append ? nextOffset || 0 : 0;
    setSearching(true);
    setError(null);
    setMessage(null);
    if (!options?.append) setResults([]);
    try {
      const response = await authenticatedFetch(
        `/api/integrations/spotify/artist-link?q=${encodeURIComponent(query.trim())}&mode=${mode}&offset=${offset}`,
      );
      const payload = await readApiJson<{ artists: ArtistPayload[]; nextOffset: number | null }>(response);
      setResults((current) => options?.append ? [...current, ...(payload.artists || [])] : (payload.artists || []));
      setNextOffset(payload.nextOffset ?? null);
      setSearchMode(mode);
      if (!payload.artists?.length && !options?.append) {
        setMessage(mode === "artist"
          ? "No apareció con ese nombre. Probá buscar por el nombre de una canción tuya."
          : "No apareció con esa canción. Probá con otro lanzamiento o con el link público del artista.");
      }
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "No se pudo buscar en Spotify.");
    } finally {
      setSearching(false);
    }
  };

  const connectCatalogArtist = async (artistId?: string) => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/integrations/spotify/artist-link", {
        method: "POST",
        body: JSON.stringify(artistId ? { artistId } : { artistUrl }),
      });
      const payload = await readApiJson<{ artist: ArtistPayload; player: PlayerSpotify }>(response);
      setPlayer(payload.player);
      setArtistUrl(payload.artist.url);
      setResults([]);
      setNextOffset(null);
      setMessage(`${payload.artist.name} quedó conectado a tu Player. El catálogo público ya está disponible en CLOUVA.`);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "No se pudo conectar el perfil público de Spotify.");
    } finally {
      setSaving(false);
    }
  };

  const syncCatalog = async () => {
    if (!player?.spotify_artist_id) return;
    await connectCatalogArtist(player.spotify_artist_id);
  };

  const importCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImporting(true);
    setError(null);
    setMessage(null);
    try {
      const csvText = await file.text();
      const response = await authenticatedFetch("/api/integrations/spotify/artist-import", {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, csvText }),
      });
      const payload = await readApiJson<{ import: ImportSummary }>(response);
      setImports((current) => [payload.import, ...current].slice(0, 10));
      setPlayer((current) => current ? { ...current, spotify_for_artists_last_import_at: payload.import.imported_at } : current);
      setMessage(`Importamos ${payload.import.row_count.toLocaleString("es-AR")} filas de Spotify for Artists.`);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "No se pudo importar el CSV.");
    } finally {
      setImporting(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("¿Desvincular Spotify for Artists y el perfil público de Spotify de tu Player?")) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await authenticatedFetch("/api/integrations/spotify/artist-link", { method: "DELETE" });
      await readApiJson(response);
      setPlayer((current) => current ? {
        ...current,
        spotify_artist_id: null,
        spotify_profile_url: null,
        spotify_sync_status: "disconnected",
        spotify_for_artists_id: null,
        spotify_for_artists_url: null,
        spotify_for_artists_status: "disconnected",
        spotify_artist_data: {},
      } : current);
      setWorkspaceUrl("");
      setArtistUrl("");
      setResults([]);
      setMessage("Spotify fue desvinculado del Player.");
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "No se pudo desvincular Spotify.");
    } finally {
      setSaving(false);
    }
  };

  const catalogArtist = player?.spotify_artist_data?.artist;
  const releases = player?.spotify_artist_data?.releases || [];
  const spotifyForArtistsConnected = player?.spotify_for_artists_status === "connected" && Boolean(player.spotify_for_artists_id);
  const publicArtistConnected = Boolean(player?.spotify_artist_id && player.spotify_profile_url);
  const latestImport = imports[0] || null;
  const canSearch = query.trim().length >= 2;
  const sourceLabel = useMemo(() => {
    if (!player?.spotify_artist_data?.source) return null;
    return player.spotify_artist_data.source === "web_api" ? "Spotify Web API" : "Spotify Embed";
  }, [player?.spotify_artist_data?.source]);

  if (loading || !player) {
    return <main className="grid min-h-screen place-items-center bg-[#05040a] text-white"><Loader2 className="animate-spin text-violet-300" /></main>;
  }

  return (
    <main className="min-h-screen bg-[#05040a] px-4 py-8 text-white sm:px-6 sm:py-10">
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
                <h1 className="mt-1 text-2xl font-black tracking-[-0.04em] sm:text-3xl">Spotify + Spotify for Artists</h1>
                <p className="mt-2 max-w-xl text-sm leading-6 text-white/55">CLOUVA separa tu cuenta personal de Spotify, tu espacio profesional de Spotify for Artists y tu perfil público de artista. Así no confundimos IDs ni perdemos datos.</p>
              </div>
            </div>
          </div>

          <div className="space-y-6 p-5 sm:p-8">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold"><UserRoundCheck size={16} /> 1. Cuenta Spotify</p>
                  <p className="mt-1 text-xs leading-5 text-white/45">Es el login personal que Spotify usa para autorizar CLOUVA. También sirve para guardar canciones y otras acciones del oyente.</p>
                </div>
                {spotifyAccount?.connected ? (
                  <span className="inline-flex items-center gap-2 self-start rounded-full border border-[#1DB954]/30 bg-[#1DB954]/10 px-3 py-2 text-xs font-bold text-[#72e49a]">
                    <CheckCircle2 size={14} /> {spotifyAccount.displayName || "Spotify conectado"}
                  </span>
                ) : (
                  <button onClick={() => void connectSpotifyAccount()} disabled={saving} className="rounded-xl bg-[#1DB954] px-4 py-2.5 text-sm font-black text-black disabled:opacity-50">
                    Conectar Spotify
                  </button>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">2. Spotify for Artists</p>
                  <p className="mt-1 text-xs leading-5 text-white/45">Pegá la URL que ves dentro de Spotify for Artists, por ejemplo <span className="text-white/60">artists.spotify.com/c/artist/.../home</span>. Ese ID se guarda como espacio profesional, no como ID público.</p>
                </div>
                {spotifyForArtistsConnected ? (
                  <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[#1DB954]/30 bg-[#1DB954]/10 px-3 py-2 text-xs font-bold text-[#72e49a]"><CheckCircle2 size={14} /> Conectado</span>
                ) : null}
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  value={workspaceUrl}
                  onChange={(event) => setWorkspaceUrl(event.target.value)}
                  placeholder="https://artists.spotify.com/c/artist/.../home"
                  className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm outline-none transition focus:border-[#1DB954]/60"
                />
                <button onClick={() => void connectWorkspace()} disabled={saving || !workspaceUrl.trim()} className="rounded-xl border border-[#1DB954]/35 px-5 py-3 text-sm font-bold text-[#72e49a] disabled:opacity-45">
                  {saving ? "Conectando…" : spotifyForArtistsConnected ? "Actualizar" : "Vincular"}
                </button>
              </div>
              {spotifyForArtistsConnected && player.spotify_for_artists_url ? (
                <a href={player.spotify_for_artists_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-white/45 hover:text-white">Abrir mi panel de Spotify for Artists <ExternalLink size={12} /></a>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">3. Perfil público y catálogo</p>
                  <p className="mt-1 text-xs leading-5 text-white/45">Este sí es el artista de <span className="text-white/60">open.spotify.com/artist/...</span>. Activa “Escuchar música”, la portada del artista y sus lanzamientos en CLOUVA.</p>
                </div>
                {publicArtistConnected ? (
                  <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-xs font-bold text-violet-200"><CheckCircle2 size={14} /> Perfil público listo</span>
                ) : null}
              </div>

              {publicArtistConnected ? (
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-16 w-16 shrink-0 rounded-2xl border border-white/10 bg-white/5 bg-cover bg-center"
                      style={catalogArtist?.imageUrl ? { backgroundImage: `url("${catalogArtist.imageUrl}")` } : undefined}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-bold">{catalogArtist?.name || player.display_name}</p>
                      <p className="mt-1 truncate text-xs text-white/40">{player.spotify_artist_id}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <a href={player.spotify_profile_url || "#"} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[#72e49a]">Ver en Spotify <ExternalLink size={11} /></a>
                        <button onClick={() => void syncCatalog()} disabled={saving} className="inline-flex items-center gap-1 text-xs text-violet-200 disabled:opacity-45"><RefreshCw size={11} className={saving ? "animate-spin" : ""} /> Actualizar catálogo</button>
                      </div>
                    </div>
                  </div>
                  {sourceLabel ? <p className="mt-3 text-[11px] text-white/30">Fuente pública: {sourceLabel}. Última sincronización: {player.spotify_last_sync_at ? new Date(player.spotify_last_sync_at).toLocaleString("es-AR") : "—"}</p> : null}
                  {releases.length ? (
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      {releases.slice(0, 6).map((release) => (
                        <a key={release.id} href={release.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-white/10 p-3 hover:bg-white/[0.03]">
                          <div className="h-11 w-11 shrink-0 rounded-lg bg-white/5 bg-cover bg-center" style={release.imageUrl ? { backgroundImage: `url("${release.imageUrl}")` } : undefined} />
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold">{release.name}</p>
                            <p className="mt-1 text-[10px] text-white/35">{release.releaseDate || release.type || "Spotify"}</p>
                          </div>
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Enter") void searchArtists(); }}
                      placeholder={searchMode === "artist" ? "Nombre artístico" : "Nombre de una canción tuya"}
                      className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm outline-none transition focus:border-[#1DB954]/60"
                    />
                    <button onClick={() => void searchArtists({ mode: searchMode })} disabled={searching || !canSearch} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1DB954] px-5 py-3 text-sm font-black text-black disabled:opacity-45">
                      {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} Buscar
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button onClick={() => { setSearchMode("artist"); setResults([]); setNextOffset(null); }} className={`rounded-full px-3 py-1.5 text-xs ${searchMode === "artist" ? "bg-white/10 text-white" : "text-white/40"}`}>Por artista</button>
                    <button onClick={() => { setSearchMode("track"); setResults([]); setNextOffset(null); }} className={`rounded-full px-3 py-1.5 text-xs ${searchMode === "track" ? "bg-white/10 text-white" : "text-white/40"}`}>Por canción</button>
                  </div>

                  {results.length ? (
                    <div className="mt-4 grid gap-2">
                      {results.map((item) => (
                        <div key={`${item.id}-${item.matchedTrack?.id || "artist"}`} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.025] p-3">
                          <div className="h-14 w-14 shrink-0 rounded-xl border border-white/10 bg-white/5 bg-cover bg-center" style={item.imageUrl ? { backgroundImage: `url("${item.imageUrl}")` } : undefined} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold">{item.name}</p>
                            <p className="mt-1 truncate text-xs text-white/40">{item.matchedTrack ? `Aparece en: ${item.matchedTrack.name}` : `Spotify ID: ${item.id}`}</p>
                          </div>
                          <button onClick={() => void connectCatalogArtist(item.id)} disabled={saving} className="shrink-0 rounded-xl bg-violet-600 px-3 py-2 text-xs font-bold hover:bg-violet-500 disabled:opacity-45">Este soy yo</button>
                        </div>
                      ))}
                      {nextOffset !== null ? (
                        <button onClick={() => void searchArtists({ append: true, mode: searchMode })} disabled={searching} className="mt-1 rounded-xl border border-white/10 px-4 py-2.5 text-xs font-semibold text-white/60 hover:text-white disabled:opacity-45">Ver más resultados</button>
                      ) : null}
                    </div>
                  ) : null}

                  <details className="mt-4 rounded-xl border border-white/10 p-4">
                    <summary className="cursor-pointer text-xs font-semibold text-white/55">Tengo el link público del artista</summary>
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <input value={artistUrl} onChange={(event) => setArtistUrl(event.target.value)} placeholder="https://open.spotify.com/artist/..." className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm outline-none focus:border-violet-400/60" />
                      <button onClick={() => void connectCatalogArtist()} disabled={saving || !artistUrl.trim()} className="rounded-xl bg-violet-600 px-5 py-3 text-sm font-bold disabled:opacity-45">Vincular perfil</button>
                    </div>
                  </details>
                </>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold"><FileSpreadsheet size={16} /> 4. Datos privados de Spotify for Artists</p>
                  <p className="mt-1 max-w-xl text-xs leading-5 text-white/45">Spotify no publica por Web API las estadísticas privadas de tu panel de artista. CLOUVA puede guardar los CSV que Spotify for Artists permite exportar: reproducciones, audiencia, canciones y playlists.</p>
                </div>
                <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-violet-400/30 px-4 py-2.5 text-xs font-bold text-violet-200 hover:bg-violet-500/10">
                  {importing ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
                  {importing ? "Importando…" : "Importar CSV"}
                  <input type="file" accept=".csv,text/csv" className="hidden" onChange={(event) => void importCsv(event)} disabled={importing} />
                </label>
              </div>
              <a href="https://artists.spotify.com/" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-[#72e49a]">Abrir Spotify for Artists para exportar <ExternalLink size={11} /></a>
              {latestImport ? (
                <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.025] p-4">
                  <p className="text-xs font-semibold">Última importación: {latestImport.file_name}</p>
                  <p className="mt-1 text-[11px] text-white/40">{latestImport.row_count.toLocaleString("es-AR")} filas · {latestImport.source_type} · {new Date(latestImport.imported_at).toLocaleString("es-AR")}</p>
                </div>
              ) : null}
            </div>

            {message ? <p className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{message}</p> : null}
            {error ? <p className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p> : null}

            {(spotifyForArtistsConnected || publicArtistConnected) ? (
              <button onClick={() => void disconnect()} disabled={saving} className="inline-flex items-center gap-2 text-xs font-semibold text-red-300/70 hover:text-red-300 disabled:opacity-45"><Unlink size={13} /> Desvincular Spotify del Player</button>
            ) : null}

            <p className="text-xs leading-5 text-white/30">CLOUVA no usa tu token personal como si fuera una credencial de artista. La cuenta Spotify, el workspace de Spotify for Artists, el artista público y las estadísticas privadas se guardan como piezas separadas.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
