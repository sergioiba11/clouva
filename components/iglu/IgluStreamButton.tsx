"use client";

import { LoaderCircle, Pause, Play } from "lucide-react";
import { useRef, useState } from "react";

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
  fallbackTrack?: MediaTrack | null;
  kickLive?: {
    title: string;
    watchUrl: string;
  } | null;
  youtubeLive?: {
    title: string;
    watchUrl: string;
  } | null;
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

function pickRadioTrack(payload: StreamPayload, avoidTrackId?: string | null) {
  const playable = (payload.tracks ?? []).filter((item) => Boolean(item.audioUrl));
  const pool = avoidTrackId && playable.length > 1
    ? playable.filter((item) => item.id !== avoidTrackId)
    : playable;
  if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
  return payload.fallbackTrack?.audioUrl ? payload.fallbackTrack : null;
}

export function IgluStreamButton({
  className,
  mediaHref,
  studioName,
}: {
  className: string;
  mediaHref: string;
  studioName: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [track, setTrack] = useState<MediaTrack | null>(null);

  async function playAudio(audio: HTMLAudioElement, nextTrack: MediaTrack) {
    audio.src = nextTrack.audioUrl || "";
    audio.load();
    setTrack(nextTrack);
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      window.location.assign(mediaHref);
    }
  }

  async function loadMediaPayload() {
    const response = await fetch("/api/iglu/media/audio", { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as StreamPayload;
    if (!response.ok) throw new Error("media_unavailable");
    return payload;
  }

  async function startRadio({
    resumeCurrent = false,
    avoidTrackId = null,
  }: {
    resumeCurrent?: boolean;
    avoidTrackId?: string | null;
  } = {}) {
    const audio = audioRef.current;
    if (!audio) throw new Error("audio_unavailable");

    const payload = await loadMediaPayload();

    // A real live has absolute priority. Right now IGLÚ detects Kick and
    // YouTube; this resolver is intentionally centralized so more networks can
    // be added without changing the button behavior.
    const liveUrl = activeLiveUrl(payload);
    if (liveUrl) {
      window.location.assign(liveUrl);
      return;
    }

    if (resumeCurrent && track?.audioUrl && audio.src) {
      await audio.play();
      setPlaying(true);
      return;
    }

    const nextTrack = pickRadioTrack(payload, avoidTrackId);
    if (nextTrack?.audioUrl) {
      await playAudio(audio, nextTrack);
      return;
    }

    // If the studio has a direct radio signal configured, use it as the audio
    // fallback only when there are no uploaded tracks.
    const radioStream = publicHttpUrl(payload.radio?.stream_url);
    if (radioStream) {
      await playAudio(audio, {
        id: "iglu-radio-live",
        title: payload.radio?.station_name || "IGLÚ Radio",
        artist: studioName,
        album: "Señal del IGLÚ",
        duration_seconds: null,
        audioUrl: radioStream,
      });
      return;
    }

    const podcastUrl = publicHttpUrl(payload.radio?.podcast_rss_url);
    if (podcastUrl) {
      window.location.assign(podcastUrl);
      return;
    }

    window.location.assign(mediaHref);
  }

  async function handleClick() {
    const audio = audioRef.current;

    if (playing && audio) {
      audio.pause();
      setPlaying(false);
      return;
    }

    setLoading(true);
    try {
      // Even when resuming a paused song, re-check live state first. If IGLÚ
      // went live while the radio was paused, the next Play opens that stream.
      await startRadio({ resumeCurrent: true });
    } catch {
      window.location.assign(mediaHref);
    } finally {
      setLoading(false);
    }
  }

  async function handleEnded() {
    const endedTrackId = track?.id || null;
    setPlaying(false);
    setLoading(true);
    try {
      // Radio behavior: move automatically to another uploaded song. The live
      // check runs again between songs, so a newly started stream takes over.
      await startRadio({ avoidTrackId: endedTrackId });
    } catch {
      setTrack(null);
    } finally {
      setLoading(false);
    }
  }

  const detail = [track?.artist || studioName, track?.album].filter(Boolean).join(" · ");

  return (
    <div
      style={{
        position: "relative",
        width: "clamp(54px, 12vw, 62px)",
        minWidth: "54px",
        justifySelf: "end",
      }}
    >
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => void handleEnded()}
      />

      <button
        type="button"
        className={className}
        onClick={() => void handleClick()}
        disabled={loading}
        aria-label={loading ? "Cargando música de IGLÚ" : playing ? "Pausar música de IGLÚ" : "Reproducir IGLÚ"}
        title={playing ? "Pausar" : "Play"}
      >
        {loading ? (
          <LoaderCircle aria-hidden="true" size={20} strokeWidth={2} className="animate-spin" />
        ) : playing ? (
          <Pause aria-hidden="true" size={21} strokeWidth={1.9} fill="currentColor" />
        ) : (
          <Play aria-hidden="true" size={22} strokeWidth={1.9} fill="currentColor" />
        )}
      </button>

      {track ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "absolute",
            zIndex: 30,
            top: "calc(100% + 8px)",
            right: 0,
            width: "min(76vw, 270px)",
            padding: "9px 11px",
            border: "1px solid rgba(154,220,255,.2)",
            borderRadius: 13,
            background: "rgba(1,8,16,.96)",
            boxShadow: "0 16px 38px rgba(0,0,0,.42)",
            backdropFilter: "blur(16px)",
            textAlign: "left",
            lineHeight: 1.15,
          }}
        >
          <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: ".14em", color: "rgba(166,224,255,.68)" }}>
            {playing ? "SONANDO EN EL IGLÚ" : "IGLÚ PLAYER"}
          </div>
          <div
            style={{
              marginTop: 4,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 11,
              fontWeight: 800,
              color: "#fff",
            }}
          >
            {track.title}
          </div>
          <div
            style={{
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: 9,
              color: "rgba(255,255,255,.5)",
            }}
          >
            {detail}
          </div>
        </div>
      ) : null}
    </div>
  );
}
