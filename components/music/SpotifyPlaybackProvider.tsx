"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "@/components/auth-provider";
import {
  controlSpotifyPlayback,
  getSpotifyPlaybackState,
  type SpotifyPlaybackAction,
  type SpotifyPlaybackState,
} from "@/lib/music/spotify-client";
import type { SpotifyPublicConnection } from "@/core/integrations/spotify/types";

type SpotifyPlaybackContextValue = {
  enabled: boolean;
  connected: boolean;
  scopesReady: boolean;
  connection: SpotifyPublicConnection | null;
  playback: SpotifyPlaybackState | null;
  loading: boolean;
  error: string | null;
  busyAction: SpotifyPlaybackAction | null;
  refreshPlayback: () => Promise<void>;
  controlPlayback: (action: SpotifyPlaybackAction) => Promise<void>;
};

const SpotifyPlaybackContext = createContext<SpotifyPlaybackContextValue | undefined>(undefined);

export function SpotifyPlaybackProvider({ children }: { children: React.ReactNode }) {
  const { user, hydrationReady } = useAuth();
  const [enabled, setEnabled] = useState(true);
  const [connected, setConnected] = useState(false);
  const [scopesReady, setScopesReady] = useState(false);
  const [connection, setConnection] = useState<SpotifyPublicConnection | null>(null);
  const [playback, setPlayback] = useState<SpotifyPlaybackState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<SpotifyPlaybackAction | null>(null);
  const requestRef = useRef(0);

  const clear = useCallback(() => {
    requestRef.current += 1;
    setEnabled(true);
    setConnected(false);
    setScopesReady(false);
    setConnection(null);
    setPlayback(null);
    setLoading(false);
    setError(null);
    setBusyAction(null);
  }, []);

  const refreshPlayback = useCallback(async () => {
    if (!hydrationReady) return;
    if (!user) {
      clear();
      return;
    }

    const requestId = ++requestRef.current;
    try {
      const snapshot = await getSpotifyPlaybackState();
      if (requestId !== requestRef.current) return;
      setEnabled(snapshot.enabled !== false);
      setConnected(Boolean(snapshot.connected));
      setScopesReady(Boolean(snapshot.scopesReady));
      setConnection(snapshot.connection || null);
      setPlayback(snapshot.playback || null);
      setError(null);
    } catch (requestError) {
      if (requestId !== requestRef.current) return;
      setPlayback(null);
      setError(requestError instanceof Error ? requestError.message : "No se pudo leer Spotify.");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [clear, hydrationReady, user]);

  useEffect(() => {
    setLoading(Boolean(user));
    void refreshPlayback();
  }, [refreshPlayback, user]);

  useEffect(() => {
    if (!user || !connected || !scopesReady) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshPlayback();
    }, 5_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshPlayback();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [connected, refreshPlayback, scopesReady, user]);

  const controlPlayback = useCallback(async (action: SpotifyPlaybackAction) => {
    if (!user || busyAction) return;
    setBusyAction(action);
    setError(null);
    try {
      await controlSpotifyPlayback(action);
      await new Promise((resolve) => window.setTimeout(resolve, 220));
      await refreshPlayback();
    } catch (controlError) {
      setError(controlError instanceof Error ? controlError.message : "No se pudo controlar Spotify.");
      throw controlError;
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, refreshPlayback, user]);

  const value = useMemo<SpotifyPlaybackContextValue>(() => ({
    enabled,
    connected,
    scopesReady,
    connection,
    playback,
    loading,
    error,
    busyAction,
    refreshPlayback,
    controlPlayback,
  }), [
    busyAction,
    connected,
    connection,
    enabled,
    error,
    loading,
    playback,
    refreshPlayback,
    scopesReady,
    controlPlayback,
  ]);

  return <SpotifyPlaybackContext.Provider value={value}>{children}</SpotifyPlaybackContext.Provider>;
}

export function useSpotifyPlayback() {
  const context = useContext(SpotifyPlaybackContext);
  if (!context) throw new Error("useSpotifyPlayback must be used within SpotifyPlaybackProvider");
  return context;
}
