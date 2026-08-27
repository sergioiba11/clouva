"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { useSpotifyPlayback } from "@/components/music/SpotifyPlaybackProvider";
import { startSpotifyConnection } from "@/lib/music/spotify-client";

export function SpotifyHomeStatus() {
  const { user } = useAuth();
  const {
    enabled,
    connected,
    scopesReady,
    connection,
    playback,
    loading,
    error,
  } = useSpotifyPlayback();
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    if (!user || busy || !enabled) return;
    setBusy(true);
    try {
      await startSpotifyConnection({ returnPath: "/" });
    } finally {
      setBusy(false);
    }
  };

  const title = loading
    ? "Comprobando Spotify…"
    : !enabled
      ? "Spotify no disponible"
      : !connected
        ? "Conectá Spotify"
        : playback?.track.title || "Spotify conectado";

  const detail = playback?.track.artist
    || connection?.displayName
    || (connected ? "Tu cuenta está disponible en CLOUVA" : "Conectá tu cuenta sin salir del Home");

  return (
    <div>
      <small>{playback?.isPlaying ? "Sonando ahora" : "Tu música"}</small>
      <strong>{title}</strong>
      <span>{detail}</span>
      {!loading && enabled && (!connected || !scopesReady) ? (
        <button
          type="button"
          onClick={connect}
          disabled={busy}
          aria-label={connected ? "Reconectar Spotify para activar controles" : "Conectar mi cuenta de Spotify"}
          style={{
            marginTop: 6,
            width: "fit-content",
            border: 0,
            borderRadius: 999,
            padding: "6px 11px",
            background: "#1ed760",
            color: "#06120a",
            fontSize: 11,
            fontWeight: 800,
            lineHeight: 1,
            cursor: busy ? "wait" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "Abriendo Spotify…" : connected ? "Activar controles" : "Conectar Spotify"}
        </button>
      ) : null}
      {error ? <span role="status" style={{ marginTop: 4, color: "#ff9b9b" }}>{error}</span> : null}
    </div>
  );
}
