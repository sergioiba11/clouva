"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { getSpotifyConnectionStatus } from "@/lib/music/spotify-client";

export function SpotifyHomeStatus() {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setConnected(false);
      setDisplayName(null);
      return;
    }
    let cancelled = false;
    void getSpotifyConnectionStatus()
      .then((result) => {
        if (cancelled) return;
        setConnected(Boolean(result.connection?.connected));
        setDisplayName(result.connection?.displayName || null);
      })
      .catch(() => {
        if (!cancelled) setConnected(false);
      });
    return () => { cancelled = true; };
  }, [user]);

  return (
    <div>
      <small>Tu música</small>
      <strong>{connected ? "Spotify conectado" : "Conectá Spotify"}</strong>
      <span>{connected ? (displayName || "Disponible en CLOUVA") : "Guardá canciones y seguí artistas desde CLOUVA"}</span>
    </div>
  );
}
