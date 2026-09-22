"use client";

import Link from "next/link";
import { ExternalLink, Headphones, Podcast, Radio, Upload, Youtube } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { ProfileRadioSettingsCard } from "@/components/radio/ProfileRadioSettingsCard";
import { IGLU_PUBLIC_PATH } from "@/lib/iglu-radio/routes";
import styles from "./IgluFunctional.module.css";

type Track = {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  duration_seconds: number | null;
  artwork_url: string | null;
  youtube_url: string | null;
  audioUrl: string | null;
};

type YoutubeLive = {
  videoId: string;
  title: string;
  description: string | null;
  startedAt: string | null;
  thumbnailUrl: string | null;
  watchUrl: string;
  embedUrl: string;
};

type KickLive = {
  platform: "kick";
  slug: string;
  title: string;
  watchUrl: string;
  startedAt: string | null;
  thumbnailUrl: string | null;
  viewerCount: number | null;
};

type LibraryPayload = {
  studio?: { id: string; name: string };
  radio?: {
    station_name: string;
    tagline: string | null;
    stream_url: string | null;
    artwork_url: string | null;
    primary_track_id?: string | null;
    kick_channel_url: string | null;
    podcast_rss_url: string | null;
  } | null;
  tracks?: Track[];
  primaryTrack?: Track | null;
  fallbackTrack?: Track | null;
  youtubeLive?: YoutubeLive | null;
  kickLive?: KickLive | null;
  error?: string;
};

function publicHttpUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function IgluMediaLive({ studioId, studioName, publicAlias }: { studioId: string; studioName: string; publicAlias: string }) {
  const [data, setData] = useState<LibraryPayload>({ tracks: [] });
  const [loading, setLoading] = useState(true);
  const [manager, setManager] = useState(false);
  const [youtubeConnected, setYoutubeConnected] = useState<boolean | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectingPrimary, setSelectingPrimary] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const response = await fetch("/api/iglu/media/audio", { cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as LibraryPayload;
    setData(payload);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    fetch(`/api/studios/${studioId}/dashboard`, { credentials: "include", cache: "no-store" })
      .then((response) => setManager(response.ok))
      .catch(() => setManager(false));
    fetch("/api/integrations/youtube/status", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return setYoutubeConnected(false);
        const body = await response.json().catch(() => ({})) as { connection?: { connected?: boolean } };
        setYoutubeConnected(Boolean(body.connection?.connected));
      })
      .catch(() => setYoutubeConnected(false));
  }, [studioId]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setUploading(true);
    setMessage(null);
    const response = await fetch("/api/iglu/media/audio", { method: "POST", body: new FormData(form), credentials: "include" });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setMessage(payload.error || "No se pudo subir el audio.");
      setUploading(false);
      return;
    }
    form.reset();
    setMessage("Audio publicado en la biblioteca del IGLÚ.");
    setUploading(false);
    await load();
  }

  const hasStream = Boolean(data.radio?.stream_url);
  const kickLive = data.kickLive || null;
  const youtubeLive = data.youtubeLive || null;
  const primaryTrack = data.primaryTrack || null;
  const fallbackTrack = data.fallbackTrack || primaryTrack;
  const tracks = data.tracks ?? [];
  const kickChannelUrl = publicHttpUrl(data.radio?.kick_channel_url);
  const podcastUrl = publicHttpUrl(data.radio?.podcast_rss_url);

  async function selectPrimary(trackId: string) {
    setSelectingPrimary(trackId);
    setMessage(null);
    const response = await fetch("/api/iglu/media/audio", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackId }),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      setMessage(payload.error || "No se pudo cambiar el audio principal.");
      setSelectingPrimary(null);
      return;
    }
    setMessage("Reproducción principal actualizada.");
    setSelectingPrimary(null);
    await load();
  }

  return (
    <div className={styles.root}>
      <main className={styles.shell}>
        <Link className={styles.back} href={IGLU_PUBLIC_PATH}>← Volver al IGLÚ</Link>
        <header className={styles.header}>
          <p className={styles.eyebrow}>IGLÚ RECORDS · MEDIA</p>
          <h1 className={styles.title}>MEDIA / LIVE</h1>
          <p className={styles.subtitle}>Kick y YouTube tienen prioridad cuando existe una transmisión real. Si no hay directo, IGLÚ reproduce música de su biblioteca.</p>
        </header>

        <section className={styles.section}>
          <div className={styles.mediaHero}>
            {kickLive ? (
              <>
                <div style={{ position: "relative", aspectRatio: "16 / 9", overflow: "hidden", background: "#020703" }}>
                  {kickLive.thumbnailUrl ? (
                    <img src={kickLive.thumbnailUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <div className={styles.mediaVisual}><Radio size={38} /><strong>KICK LIVE</strong></div>
                  )}
                  <span style={{ position: "absolute", left: 12, top: 12, zIndex: 2, borderRadius: 999, padding: "6px 10px", background: "#53fc18", color: "#061000", fontSize: 10, fontWeight: 900, letterSpacing: ".08em" }}>● EN VIVO · KICK</span>
                </div>
                <div style={{ padding: 14 }}>
                  <p className={styles.cardTitle}>{kickLive.title}</p>
                  <p className={styles.meta}>{kickLive.viewerCount != null ? `${kickLive.viewerCount} viewers · ` : ""}Transmisión oficial detectada por CLOUVA.</p>
                  <a className={styles.primaryButton} href={kickLive.watchUrl} target="_blank" rel="noreferrer" style={{ marginTop: 12 }}>ABRIR KICK <ExternalLink size={14} /></a>
                </div>
              </>
            ) : youtubeLive ? (
              <>
                <div style={{ position: "relative", aspectRatio: "16 / 9", background: "#000" }}>
                  <iframe
                    title={youtubeLive.title}
                    src={youtubeLive.embedUrl}
                    allow="autoplay; encrypted-media; picture-in-picture"
                    allowFullScreen
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
                  />
                  <span style={{ position: "absolute", left: 12, top: 12, zIndex: 2, borderRadius: 999, padding: "6px 10px", background: "#e51d36", color: "#fff", fontSize: 10, fontWeight: 900, letterSpacing: ".08em" }}>● EN VIVO · YOUTUBE</span>
                </div>
                <div style={{ padding: 14 }}>
                  <p className={styles.cardTitle}>{youtubeLive.title}</p>
                  <p className={styles.meta}>Transmisión visual en vivo conectada desde YouTube.</p>
                </div>
              </>
            ) : (
              <>
                <div className={styles.mediaVisual}>
                  <Radio size={38} />
                  <strong>{fallbackTrack?.title || data.radio?.station_name || "IGLÚ MEDIA"}</strong>
                  <span>
                    {fallbackTrack
                      ? `PLAYER · ${fallbackTrack.artist || studioName}${fallbackTrack.album ? ` · ${fallbackTrack.album}` : ""}`
                      : hasStream
                        ? "Señal de audio configurada"
                        : "No hay transmisión ni audio principal configurado"}
                  </span>
                </div>
                {fallbackTrack?.audioUrl ? (
                  <audio controls preload="metadata" src={fallbackTrack.audioUrl} style={{ width: "100%" }} />
                ) : hasStream ? (
                  <audio controls preload="none" src={data.radio?.stream_url || undefined} style={{ width: "100%" }} />
                ) : null}
              </>
            )}
          </div>
        </section>

        <section className={styles.section} id="library">
          <div className={styles.sectionHead}><h2>Biblioteca</h2><span>{loading ? "Cargando…" : `${tracks.length} audios`}</span></div>
          <div className={styles.grid}>
            {tracks.map((track) => (
              <article className={styles.card} key={track.id}>
                <div className={styles.audioRow}>
                  <span className={styles.audioIcon}><Headphones size={20} /></span>
                  <div>
                    <p className={styles.cardTitle}>{track.title}</p>
                    <p className={styles.meta}>{track.artist || studioName}{track.album ? ` · ${track.album}` : ""}</p>
                  </div>
                  {track.audioUrl ? <audio controls preload="none" src={track.audioUrl} /> : null}
                  {track.youtube_url ? <Link className={styles.secondaryButton} href={track.youtube_url}>YouTube</Link> : null}
                  {manager && track.audioUrl ? (
                    <button
                      type="button"
                      className={data.radio?.primary_track_id === track.id ? styles.primaryButton : styles.secondaryButton}
                      disabled={selectingPrimary === track.id}
                      onClick={() => void selectPrimary(track.id)}
                    >
                      {selectingPrimary === track.id ? "Guardando…" : data.radio?.primary_track_id === track.id ? "Principal ✓" : "Usar como principal"}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
            {!loading && !tracks.length ? <div className={styles.empty}>Todavía no hay audios publicados en la carpeta del IGLÚ.</div> : null}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}><h2>Conexiones</h2><span>Fuentes reales</span></div>
          <div className={styles.grid2}>
            <div className={styles.card} style={{ padding: 14 }}>
              <Youtube size={21} />
              <p className={styles.cardTitle} style={{ marginTop: 10 }}>YouTube</p>
              <p className={styles.meta}>{youtubeLive ? "EN VIVO ahora." : youtubeConnected ? "Canal conectado a tu cuenta CLOUVA." : "Todavía no hay un canal conectado en esta sesión."}</p>
              <Link className={styles.secondaryButton} href="/profile/edit" style={{ marginTop: 12 }}>Gestionar YouTube →</Link>
            </div>

            <div className={styles.card} style={{ padding: 14 }}>
              <Radio size={21} />
              <p className={styles.cardTitle} style={{ marginTop: 10 }}>Kick</p>
              <p className={styles.meta}>{kickLive ? "EN VIVO ahora." : kickChannelUrl ? "Canal configurado. CLOUVA consulta su estado real." : "Configurá el canal desde Administrar Media."}</p>
              {kickChannelUrl ? <a className={styles.secondaryButton} href={kickChannelUrl} target="_blank" rel="noreferrer" style={{ marginTop: 12 }}>Abrir Kick <ExternalLink size={13} /></a> : null}
            </div>

            <div className={styles.card} style={{ padding: 14 }}>
              <Podcast size={21} />
              <p className={styles.cardTitle} style={{ marginTop: 10 }}>Podcast</p>
              <p className={styles.meta}>{podcastUrl ? "Fuente de podcast conectada." : "Configurá una URL o RSS desde Administrar Media."}</p>
              {podcastUrl ? <a className={styles.secondaryButton} href={podcastUrl} target="_blank" rel="noreferrer" style={{ marginTop: 12 }}>Abrir podcast <ExternalLink size={13} /></a> : null}
            </div>
          </div>
        </section>

        {manager ? (
          <section className={styles.section}>
            <div className={styles.sectionHead}><h2>Administrar Media</h2><span>Studio manager</span></div>
            <form className={styles.form} onSubmit={upload}>
              <label className={styles.file}><Upload size={18} /> Subir audio MP3, WAV o FLAC<input name="file" type="file" accept=".mp3,.wav,.flac,audio/mpeg,audio/wav,audio/flac" required /></label>
              <input className={styles.input} name="title" placeholder="Título" required maxLength={220} />
              <input className={styles.input} name="artist" placeholder="Player / artista" maxLength={220} />
              <button className={styles.primaryButton} type="submit" disabled={uploading}>{uploading ? "Subiendo…" : "SUBIR AUDIO"}</button>
            </form>
            {message ? <p className={message.includes("No se pudo") ? styles.error : styles.meta}>{message}</p> : null}
            <div style={{ marginTop: 16 }}>
              <ProfileRadioSettingsCard ownerKind="studio" ownerId={studioId} profileName={studioName} publicAlias={publicAlias} />
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
