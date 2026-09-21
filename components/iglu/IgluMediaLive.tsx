"use client";

import Link from "next/link";
import { Headphones, Radio, Upload, Youtube } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { ProfileRadioSettingsCard } from "@/components/radio/ProfileRadioSettingsCard";
import styles from "./IgluFunctional.module.css";

type Track = {
  id: string;
  title: string;
  artist: string | null;
  duration_seconds: number | null;
  artwork_url: string | null;
  youtube_url: string | null;
  audioUrl: string | null;
};

type LibraryPayload = {
  studio?: { id: string; name: string };
  radio?: { station_name: string; tagline: string | null; stream_url: string | null; artwork_url: string | null } | null;
  tracks?: Track[];
  error?: string;
};

export function IgluMediaLive({ studioId, studioName, publicAlias }: { studioId: string; studioName: string; publicAlias: string }) {
  const [data, setData] = useState<LibraryPayload>({ tracks: [] });
  const [loading, setLoading] = useState(true);
  const [manager, setManager] = useState(false);
  const [youtubeConnected, setYoutubeConnected] = useState<boolean | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
  const tracks = data.tracks ?? [];

  return (
    <div className={styles.root}>
      <main className={styles.shell}>
        <Link className={styles.back} href="/lamatrix/estudios/eliglurecords">← Volver al IGLÚ</Link>
        <header className={styles.header}>
          <p className={styles.eyebrow}>IGLÚ RECORDS · MEDIA</p>
          <h1 className={styles.title}>MEDIA / LIVE</h1>
          <p className={styles.subtitle}>La reproducción usa solamente fuentes reales configuradas en CLOUVA. Un estado EN VIVO aparece únicamente cuando existe una señal real.</p>
        </header>

        <section className={styles.section}>
          <div className={styles.mediaHero}>
            <div className={styles.mediaVisual}>
              <Radio size={38} />
              <strong>{data.radio?.station_name || "IGLÚ RADIO"}</strong>
              <span>{hasStream ? "Señal de audio configurada" : "Sin transmisión en vivo configurada"}</span>
            </div>
            {hasStream ? <audio controls preload="none" src={data.radio?.stream_url || undefined} style={{ width: "100%" }} /> : null}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}><h2>Biblioteca</h2><span>{loading ? "Cargando…" : `${tracks.length} audios`}</span></div>
          <div className={styles.grid}>
            {tracks.map((track) => (
              <article className={styles.card} key={track.id}>
                <div className={styles.audioRow}>
                  <span className={styles.audioIcon}><Headphones size={20} /></span>
                  <div><p className={styles.cardTitle}>{track.title}</p><p className={styles.meta}>{track.artist || studioName}</p></div>
                  {track.audioUrl ? <audio controls preload="none" src={track.audioUrl} /> : null}
                  {track.youtube_url ? <Link className={styles.secondaryButton} href={track.youtube_url}>YouTube</Link> : null}
                </div>
              </article>
            ))}
            {!loading && !tracks.length ? <div className={styles.empty}>Todavía no hay audios publicados. No mostramos contenido de ejemplo.</div> : null}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}><h2>Conexiones</h2><span>Fuentes reales</span></div>
          <div className={styles.grid2}>
            <div className={styles.card} style={{ padding: 14 }}>
              <Youtube size={21} />
              <p className={styles.cardTitle} style={{ marginTop: 10 }}>YouTube</p>
              <p className={styles.meta}>{youtubeConnected ? "Canal conectado a tu cuenta CLOUVA." : "Todavía no hay un canal conectado en esta sesión."}</p>
              <Link className={styles.secondaryButton} href="/profile/edit" style={{ marginTop: 12 }}>Gestionar YouTube →</Link>
            </div>
            <div className={styles.card} style={{ padding: 14 }}>
              <Radio size={21} />
              <p className={styles.cardTitle} style={{ marginTop: 10 }}>Kick / Podcast</p>
              <p className={styles.meta}>No se marca como conectado hasta que exista una integración o URL compatible real.</p>
            </div>
          </div>
        </section>

        {manager ? (
          <section className={styles.section}>
            <div className={styles.sectionHead}><h2>Administrar Media</h2><span>Studio manager</span></div>
            <form className={styles.form} onSubmit={upload}>
              <label className={styles.file}><Upload size={18} /> Subir audio MP3, WAV o FLAC<input name="file" type="file" accept=".mp3,.wav,.flac,audio/mpeg,audio/wav,audio/flac" required /></label>
              <input className={styles.input} name="title" placeholder="Título" required maxLength={220} />
              <input className={styles.input} name="artist" placeholder="Artista / autor" maxLength={220} />
              <button className={styles.primaryButton} type="submit" disabled={uploading}>{uploading ? "Subiendo…" : "SUBIR AUDIO"}</button>
            </form>
            {message ? <p className={message.startsWith("Audio") ? styles.meta : styles.error}>{message}</p> : null}
            <div style={{ marginTop: 16 }}>
              <ProfileRadioSettingsCard ownerKind="studio" ownerId={studioId} profileName={studioName} publicAlias={publicAlias} />
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
