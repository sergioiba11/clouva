"use client";

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
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);

  async function handleClick() {
    const audio = audioRef.current;

    if (playing && audio) {
      audio.pause();
      setPlaying(false);
      return;
    }

    if (track?.audioUrl && audio?.src) {
      try {
        await audio.play();
        setPlaying(true);
      } catch {
        window.location.assign(mediaHref);
      }
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/iglu/media/audio", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as StreamPayload;
      if (!response.ok) throw new Error("media_unavailable");

      const kickUrl = publicHttpUrl(payload.kickLive?.watchUrl);
      if (kickUrl) {
        window.location.assign(kickUrl);
        return;
      }

      const youtubeUrl = publicHttpUrl(payload.youtubeLive?.watchUrl);
      if (youtubeUrl) {
        window.location.assign(youtubeUrl);
        return;
      }

      const fallback = payload.fallbackTrack || null;
      if (fallback?.audioUrl && audio) {
        audio.src = fallback.audioUrl;
        audio.load();
        setTrack(fallback);
        setSourceLabel("IGLÚ · PLAYER");
        try {
          await audio.play();
          setPlaying(true);
        } catch {
          setPlaying(false);
        }
        return;
      }

      const radioStream = publicHttpUrl(payload.radio?.stream_url);
      if (radioStream && audio) {
        audio.src = radioStream;
        audio.load();
        setTrack({
          id: "iglu-radio-live",
          title: payload.radio?.station_name || "IGLÚ Radio",
          artist: studioName,
          album: "Señal de audio",
          duration_seconds: null,
          audioUrl: radioStream,
        });
        setSourceLabel("IGLÚ · AUDIO");
        try {
          await audio.play();
          setPlaying(true);
        } catch {
          setPlaying(false);
        }
        return;
      }

      window.location.assign(mediaHref);
    } catch {
      window.location.assign(mediaHref);
    } finally {
      setLoading(false);
    }
  }

  const artist = track?.artist || studioName;
  const detail = [artist, track?.album].filter(Boolean).join(" · ");

  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      <audio
        ref={audioRef}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTrack(null);
          setSourceLabel(null);
        }}
      />
      <button
        type="button"
        className={className}
        onClick={() => void handleClick()}
        disabled={loading}
        aria-label={playing ? "Pausar IGLÚ" : "Reproducir IGLÚ o abrir transmisión en vivo"}
        style={{ width: "100%", paddingInline: 14, gap: 8, font: "inherit" }}
      >
        <span aria-hidden="true">{loading ? "···" : playing ? "Ⅱ" : "▶"}</span>
        {track ? (
          <span style={{ minWidth: 0, textAlign: "left", lineHeight: 1.05 }}>
            <small style={{ display: "block", fontSize: 8, opacity: 0.68, letterSpacing: ".1em" }}>
              {sourceLabel}
            </small>
            <strong
              style={{
                display: "block",
                maxWidth: 150,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 10,
              }}
            >
              {track.title}
            </strong>
          </span>
        ) : null}
      </button>

      {track ? (
        <div
          role="status"
          style={{
            position: "absolute",
            zIndex: 30,
            top: "calc(100% + 8px)",
            right: 0,
            width: "min(78vw, 300px)",
            padding: "10px 12px",
            border: "1px solid rgba(154,220,255,.24)",
            borderRadius: 14,
            background: "rgba(1,8,16,.96)",
            boxShadow: "0 18px 44px rgba(0,0,0,.45)",
            backdropFilter: "blur(16px)",
            textAlign: "left",
          }}
        >
          <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: ".15em", color: "rgba(166,224,255,.72)" }}>
            {sourceLabel}
          </div>
          <div style={{ marginTop: 3, fontSize: 12, fontWeight: 800, color: "#fff" }}>{track.title}</div>
          <div style={{ marginTop: 2, fontSize: 10, color: "rgba(255,255,255,.58)" }}>{detail}</div>
        </div>
      ) : null}
    </div>
  );
}
