"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { getSpotifyConnectionStatus, startSpotifyConnection } from "@/lib/music/spotify-client";

export function SpotifyHomeStatus() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [connected, setConnected] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setLoading(false);
      setConnected(false);
      setDisplayName(null);
      return;
    }
    try {
      const result = await getSpotifyConnectionStatus();
      setEnabled(result.enabled !== false);
      setConnected(Boolean(result.connection?.connected));
      setDisplayName(result.connection?.displayName || null);
      setError(null);
    } catch {
      setConnected(false);
      setError("No pudimos comprobar Spotify.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = async () => {
    if (!user || busy || !enabled) return;
    setBusy(true);
    setError(null);
    try {
      await startSpotifyConnection({ returnPath: "/" });
    } catch {
      setBusy(false);
      setError("No pudimos abrir Spotify. Intentá de nuevo.");
    }
  };

  return (
    <div>
      <small>Tu música</small>
      <strong>{loading ? "Comprobando Spotify…" : connected ? "Spotify conectado" : "Conectá Spotify"}</strong>
      <span>
        {connected
          ? (displayName || "Tu cuenta está disponible en CLOUVA")
          : enabled
            ? "Conectá tu cuenta sin salir del Home"
            : "Spotify todavía no está disponible"}
      </span>
      {!loading && !connected && enabled ? (
        <button
          type="button"
          onClick={connect}
          disabled={busy}
          aria-label="Conectar mi cuenta de Spotify"
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
          {busy ? "Abriendo Spotify…" : "Conectar Spotify"}
        </button>
      ) : null}
      {error ? <span role="status" style={{ marginTop: 4, color: "#ff9b9b" }}>{error}</span> : null}
    </div>
  );
}
