"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { CURRENT_PLAYER_CHANGED_EVENT } from "@/lib/current-player-events";
import type { Player } from "@/lib/players-data";

type CurrentPlayerContextType = {
  currentPlayer: Player | null;
  playerLoading: boolean;
  playerReady: boolean;
  playerError: string | null;
  refreshCurrentPlayer: () => Promise<void>;
};

const CurrentPlayerContext = createContext<CurrentPlayerContextType | undefined>(undefined);

export function CurrentPlayerProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading, hydrationReady, profileReady } = useAuth();
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const requestRef = useRef(0);
  const pendingUserIdRef = useRef<string | null>(null);
  const resolvedUserIdRef = useRef<string | null>(null);

  const clearCurrentPlayer = useCallback(() => {
    requestRef.current += 1;
    pendingUserIdRef.current = null;
    resolvedUserIdRef.current = null;
    setCurrentPlayer(null);
    setPlayerError(null);
    setPlayerLoading(false);
    setPlayerReady(true);
  }, []);

  const loadCurrentPlayer = useCallback(async (userId: string, force = false) => {
    if (!force && resolvedUserIdRef.current === userId) return;
    if (!force && pendingUserIdRef.current === userId) return;

    const requestId = ++requestRef.current;
    pendingUserIdRef.current = userId;
    setPlayerLoading(true);
    setPlayerReady(false);
    setPlayerError(null);

    try {
      const response = await authenticatedFetch("/api/players/me");
      const payload = await readApiJson<{ player: Player | null }>(response);
      if (requestId !== requestRef.current) return;

      resolvedUserIdRef.current = userId;
      setCurrentPlayer(payload.player);
    } catch (error) {
      if (requestId !== requestRef.current) return;

      resolvedUserIdRef.current = userId;
      setCurrentPlayer(null);
      setPlayerError(error instanceof Error ? error.message : "No se pudo cargar tu Player.");
    } finally {
      if (pendingUserIdRef.current === userId) pendingUserIdRef.current = null;
      if (requestId === requestRef.current) {
        setPlayerLoading(false);
        setPlayerReady(true);
      }
    }
  }, []);

  const refreshCurrentPlayer = useCallback(async () => {
    if (!user) {
      clearCurrentPlayer();
      return;
    }
    await loadCurrentPlayer(user.id, true);
  }, [clearCurrentPlayer, loadCurrentPlayer, user]);

  useEffect(() => {
    if (!hydrationReady || authLoading || !profileReady) return;

    if (!user) {
      clearCurrentPlayer();
      return;
    }

    if (resolvedUserIdRef.current !== user.id && pendingUserIdRef.current !== user.id) {
      setCurrentPlayer(null);
      setPlayerError(null);
      setPlayerReady(false);
      void loadCurrentPlayer(user.id);
    }
  }, [authLoading, clearCurrentPlayer, hydrationReady, loadCurrentPlayer, profileReady, user]);

  useEffect(() => {
    const handlePlayerChanged = () => {
      void refreshCurrentPlayer();
    };
    window.addEventListener(CURRENT_PLAYER_CHANGED_EVENT, handlePlayerChanged);
    return () => window.removeEventListener(CURRENT_PLAYER_CHANGED_EVENT, handlePlayerChanged);
  }, [refreshCurrentPlayer]);

  const value = useMemo(
    () => ({ currentPlayer, playerLoading, playerReady, playerError, refreshCurrentPlayer }),
    [currentPlayer, playerError, playerLoading, playerReady, refreshCurrentPlayer],
  );

  return <CurrentPlayerContext.Provider value={value}>{children}</CurrentPlayerContext.Provider>;
}

export function useCurrentPlayer() {
  const context = useContext(CurrentPlayerContext);
  if (!context) throw new Error("useCurrentPlayer must be used within CurrentPlayerProvider");
  return context;
}
