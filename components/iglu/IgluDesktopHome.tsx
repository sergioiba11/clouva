"use client";

import Link from "next/link";
import {
  Instagram,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Youtube,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { IgluAdminMediaLink } from "@/components/iglu/IgluAdminMediaLink";
import styles from "./IgluDesktopHome.module.css";

type MediaTrack = {
  id: string;
  title: string;
  artist: string | null;
  album: string | null;
  duration_seconds: number | null;
  audioUrl: string | null;
};

type StreamPayload = {
  radio?: {
    station_name: string;
    stream_url: string | null;
    podcast_rss_url: string | null;
  } | null;
  tracks?: MediaTrack[];
  primaryTrack?: MediaTrack | null;
  fallbackTrack?: MediaTrack | null;
  kickLive?: { title: string; watchUrl: string } | null;
  youtubeLive?: { title: string; watchUrl: string } | null;
};

export type IgluDesktopAssets = {
  logo: string;
  background: string;
  heroTitle: string;
  snowflake: string;
  cta: string;
  mountain: string;
  cardOne: string;
  cardTwo: string;
  cardThree: string;
};
type Props = {
  studioName: string;
  studioDescription: string;
  reserveHref: string;
  agendaHref: string;
  mediaHref: string;
  profileHref: string;
  merchHref: string;
  assets: IgluDesktopAssets;
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

function activeLiveUrl(payload: StreamPayload) {
  return publicHttpUrl(payload.kickLive?.watchUrl) || publicHttpUrl(payload.youtubeLive?.watchUrl);
}

function playableTrack(payload: StreamPayload, avoidTrackId?: string | null) {
  const primary = payload.primaryTrack?.audioUrl ? payload.primaryTrack : null;
  if (!avoidTrackId && primary) return primary;

  const playable = (payload.tracks ?? []).filter((item) => Boolean(item.audioUrl));
  const pool = avoidTrackId && playable.length > 1
    ? playable.filter((item) => item.id !== avoidTrackId)
    : playable;

  if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
  if (primary && primary.id !== avoidTrackId) return primary;
  return payload.fallbackTrack?.audioUrl ? payload.fallbackTrack : null;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function IgluDesktopHome({
  studioName,
  studioDescription,
  reserveHref,
  agendaHref,
  mediaHref,
  profileHref,
  merchHref,
  assets,
}: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [track, setTrack] = useState<MediaTrack | null>(null);
  const [previewTrack, setPreviewTrack] = useState<MediaTrack | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  async function loadMediaPayload() {
    const response = await fetch("/api/iglu/media/audio", { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as StreamPayload;
    if (!response.ok) throw new Error("media_unavailable");
    return payload;
  }

  useEffect(() => {
    let active = true;
    loadMediaPayload()
      .then((payload) => {
        if (!active) return;
        setPreviewTrack(playableTrack(payload));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  async function playResolved({ avoidTrackId = null, resume = false }: { avoidTrackId?: string | null; resume?: boolean } = {}) {
    const audio = audioRef.current;
    if (!audio) return;

    const payload = await loadMediaPayload();
    const liveUrl = activeLiveUrl(payload);
    if (liveUrl) {
      window.location.assign(liveUrl);
      return;
    }

    if (resume && track?.audioUrl && audio.src) {
      await audio.play();
      setPlaying(true);
      return;
    }

    const next = playableTrack(payload, avoidTrackId);
    if (next?.audioUrl) {
      audio.src = next.audioUrl;
      audio.load();
      setTrack(next);
      setPreviewTrack(next);
      await audio.play();
      setPlaying(true);
      return;
    }

    const streamUrl = publicHttpUrl(payload.radio?.stream_url);
    if (streamUrl) {
      const radioTrack: MediaTrack = {
        id: "iglu-radio-live",
        title: payload.radio?.station_name || "IGLÚ Radio",
        artist: studioName,
        album: "Señal del IGLÚ",
        duration_seconds: null,
        audioUrl: streamUrl,
      };
      audio.src = streamUrl;
      audio.load();
      setTrack(radioTrack);
      setPreviewTrack(radioTrack);
      await audio.play();
      setPlaying(true);
    }
  }

  async function togglePlayback() {
    const audio = audioRef.current;
    if (playing && audio) {
      audio.pause();
      setPlaying(false);
      return;
    }

    setLoading(true);
    try {
      await playResolved({ resume: true });
    } catch {
      setPlaying(false);
    } finally {
      setLoading(false);
    }
  }

  async function nextTrack() {
    setLoading(true);
    try {
      await playResolved({ avoidTrackId: track?.id || previewTrack?.id || null });
    } catch {
      setPlaying(false);
    } finally {
      setLoading(false);
    }
  }

  function restartTrack() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setCurrentTime(0);
  }

  const displayTrack = track || previewTrack;
  const shownDuration = duration || displayTrack?.duration_seconds || 0;
  const progress = shownDuration > 0 ? Math.min(100, (currentTime / shownDuration) * 100) : 0;
  const trackDetail = useMemo(
    () => [displayTrack?.artist || studioName, displayTrack?.album].filter(Boolean).join(" · "),
    [displayTrack, studioName],
  );
  return (
    <section className={styles.desktopPage} id="inicio" aria-label="IGLÚ Records" data-description={studioDescription} data-reserve-href={reserveHref}>
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => void nextTrack()}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
      />

      <section className={styles.hero}>
        <img className={styles.heroBackground} src={assets.background} alt="" aria-hidden="true" />
        <div className={styles.heroOverlay} aria-hidden="true" />

        <header className={styles.header}>
          <Link className={styles.brand} href="#inicio" aria-label="IGLÚ Records — Inicio">
            <img className={styles.brandEmblem} src={assets.logo} alt="" aria-hidden="true" />
            <img className={styles.brandWordmark} src={assets.heroTitle} alt="IGLÚ Records" />
          </Link>

          <nav className={styles.nav} aria-label="Navegación de IGLÚ Records">
            <a href="#inicio" aria-current="page">Inicio</a>
            <Link href="/iglu/artistas">Artistas</Link>
            <Link href={`${mediaHref}#library`}>Música</Link>
            <Link href="/iglu/estudio">Estudio</Link>
            <Link href="/iglu/nosotros">Sobre Iglú</Link>
            <Link href="/iglu/contacto">Contacto</Link>
          </nav>

          <div className={styles.headerActions}>
            <IgluAdminMediaLink href={`${mediaHref}#admin-media`} className={styles.adminMedia} />
            <Link className={styles.loginButton} href={profileHref}>
              <img src={assets.snowflake} alt="" aria-hidden="true" />
              <span>Ingresar</span>
            </Link>
          </div>
        </header>

        <div className={styles.sideRail} aria-hidden="true">
          <span />
          <b>IGLÚ RECORDS 2024</b>
        </div>

        <div className={styles.heroContent}>
          <div className={styles.welcome}>
            <img src={assets.snowflake} alt="" aria-hidden="true" />
            <span>Bienvenido a</span>
          </div>

          <img className={styles.heroTitle} src={assets.heroTitle} alt="IGLÚ RECORDS" />

          <div className={styles.audioMark} aria-hidden="true">
            {Array.from({ length: 23 }).map((_, index) => <i key={index} />)}
          </div>

          <p className={styles.claim}>UN LUGAR DONDE EL FRÍO<br />GUARDA LO QUE EL FUEGO CREA.</p>

          <div className={styles.heroActions}>
            <Link
              className={styles.studioButton}
              href="/iglu/estudio"
              style={{ backgroundImage: `url("${assets.cta}")` }}
            >
              <img src={assets.snowflake} alt="" aria-hidden="true" />
              <span>Conocer el estudio</span>
            </Link>

            <button className={styles.listenButton} type="button" onClick={() => void togglePlayback()} disabled={loading}>
              {loading ? <LoaderCircle className={styles.spinner} size={19} /> : playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
              <span>{playing ? "Pausar música" : "Escuchar música"}</span>
            </button>
          </div>

          <div className={styles.scrollHint} aria-hidden="true">
            <span className={styles.mouse}><i /></span>
            <span>Scroll</span>
          </div>
        </div>
      </section>
      <section className={styles.lower}>
        <div className={styles.lowerBackground} style={{ backgroundImage: `url("${assets.background}")` }} aria-hidden="true" />
        <div className={styles.lowerShade} aria-hidden="true" />

        <div className={styles.lowerGrid}>
          <article className={styles.about}>
            <div className={styles.sectionEyebrow}>
              <img src={assets.snowflake} alt="" aria-hidden="true" />
              <span>Lo que somos</span>
              <i />
            </div>
            <h2>MÚSICA. CULTURA.<br /><strong>FAMILIA.</strong></h2>
            <p>
              IGLÚ RECORDS es un sello independiente nacido desde el sur.
              Creamos, producimos y elevamos artistas con identidad propia.
              Del hielo surgen los flows más reales.
            </p>
            <Link className={styles.aboutButton} href="/iglu/nosotros">
              <img src={assets.mountain} alt="" aria-hidden="true" />
              <span>Sobre Iglú</span>
              <span aria-hidden="true">→</span>
            </Link>
            <div className={styles.socials} aria-label="Redes de IGLÚ Records">
              <a href="#" aria-label="Instagram"><Instagram size={20} /></a>
              <a href="#" aria-label="YouTube"><Youtube size={21} /></a>
              <Link href={`${mediaHref}#library`} aria-label="Música"><Music2 size={20} /></Link>
            </div>
          </article>

          <div className={styles.assetCards} aria-label="Accesos de IGLÚ">
            <Link href="/iglu/artistas" className={`${styles.assetCard} ${styles.assetCardArtists}`} aria-label="Players">
              <img className={styles.assetImageArtists} src={assets.cardOne} alt="Players de IGLÚ Records" />
              <span className={styles.assetCardShade} aria-hidden="true" />
              <span className={styles.assetCardMeta}>
                <span className={styles.assetCardLabel}>PLAYERS</span>
                <span className={styles.assetCardArrow} aria-hidden="true">→</span>
              </span>
            </Link>
            <Link href={agendaHref} className={`${styles.assetCard} ${styles.assetCardReservations}`} aria-label="Reservas">
              <img className={styles.assetImageReservations} src={assets.cardTwo} alt="Reservas de IGLÚ Records" />
              <span className={styles.assetCardShade} aria-hidden="true" />
              <span className={styles.assetCardMeta}>
                <span className={styles.assetCardLabel}>RESERVAS</span>
                <span className={styles.assetCardArrow} aria-hidden="true">→</span>
              </span>
            </Link>
            <Link href={merchHref} className={`${styles.assetCard} ${styles.assetCardMerch}`} aria-label="Merch">
              <img className={styles.assetImageMerch} src={assets.cardThree} alt="Merch de IGLÚ Records" />
              <span className={styles.assetCardShade} aria-hidden="true" />
              <span className={styles.assetCardMeta}>
                <span className={styles.assetCardLabel}>MERCH</span>
                <span className={styles.assetCardArrow} aria-hidden="true">→</span>
              </span>
            </Link>
          </div>

          <aside className={styles.nowPlaying} aria-label="Sonando ahora">
            <div className={styles.nowHeader}>
              <span className={styles.equalizer} aria-hidden="true"><i /><i /><i /><i /></span>
              <span>Sonando ahora</span>
            </div>

            <div className={styles.playerCard}>
              <div className={styles.trackRow}>
                <div className={styles.cover}>
                  <img src={assets.heroTitle} alt="" aria-hidden="true" />
                </div>
                <div className={styles.trackMeta}>
                  <strong>{displayTrack?.title || "IGLÚ RADIO"}</strong>
                  <span>{trackDetail || "IGLÚ Records"}</span>
                </div>
                <button className={styles.heart} type="button" aria-label="Guardar canción">♡</button>
              </div>

              <div className={styles.progress}>
                <span style={{ width: `${progress}%` }} />
              </div>
              <div className={styles.timeRow}>
                <span>{formatTime(currentTime)}</span>
                <span>{shownDuration ? formatTime(shownDuration) : "--:--"}</span>
              </div>

              <div className={styles.playerControls}>
                <button type="button" onClick={restartTrack} aria-label="Volver al inicio"><SkipBack size={22} fill="currentColor" /></button>
                <button className={styles.mainControl} type="button" onClick={() => void togglePlayback()} disabled={loading} aria-label={playing ? "Pausar" : "Reproducir"}>
                  {loading ? <LoaderCircle className={styles.spinner} size={24} /> : playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
                </button>
                <button type="button" onClick={() => void nextTrack()} aria-label="Siguiente canción"><SkipForward size={22} fill="currentColor" /></button>
              </div>

              <Link className={styles.releasesLink} href={`${mediaHref}#library`}>
                <span>Ver todos los lanzamientos</span>
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </aside>
        </div>

        <footer className={styles.footer}>
          <span>IGLÚ RECORDS</span>
          <i />
          <span>TODOS LOS DERECHOS RESERVADOS</span>
        </footer>
      </section>
    </section>
  );
}
