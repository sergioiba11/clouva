"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { getSpotifyConnectionStatus, startSpotifyConnection } from "@/lib/music/spotify-client";

export function SpotifyHomeConnectAction() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      setConnected(false);
      return;
    }
    let cancelled = false;
    void getSpotifyConnectionStatus()
      .then((result) => {
        if (cancelled) return;
        setEnabled(result.enabled !== false);
        setConnected(Boolean(result.connection?.connected));
      })
      .catch(() => {
        if (!cancelled) setConnected(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user]);

  if (!user || loading || !enabled) return null;

  if (connected) {
    return (
      <span
        aria-label="Spotify conectado"
        style={{
          display: "inline-flex",
          alignItems: "center",
          width: "fit-content",
          marginTop: 8,
          borderRadius: 999,
          padding: "6px 10px",
          background: "rgba(30,215,96,.14)",
          color: "#62e791",
          fontSize: 11,
          fontWeight: 800,
          lineHeight: 1,
        }}
      >
        Spotify conectado
      </span>
    );
  }

  const connect = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await startSpotifyConnection({ returnPath: "/" });
    } catch {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={connect}
      disabled={busy}
      aria-label="Conectar mi cuenta de Spotify"
      style={{
        display: "inline-flex",
        alignItems: "center",
        width: "fit-content",
        marginTop: 8,
        border: 0,
        borderRadius: 999,
        padding: "7px 11px",
        background: "#1ed760",
        color: "#06120a",
        fontSize: 11,
        fontWeight: 900,
        lineHeight: 1,
        cursor: busy ? "wait" : "pointer",
        opacity: busy ? 0.7 : 1,
      }}
    >
      {busy ? "Abriendo Spotify…" : "Conectar Spotify"}
    </button>
  );
}
