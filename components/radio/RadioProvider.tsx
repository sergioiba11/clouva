"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RadioMetadata, RadioStationConfig, RadioStatus } from "@/lib/radio/types";

export type RadioEngineEvent = "connecting" | "playing" | "paused" | "waiting" | "error";

type RadioContextValue = {
  station: RadioStationConfig;
  status: RadioStatus;
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  expanded: boolean;
  streamUrl: string;
  hasStream: boolean;
  metadata: RadioMetadata;
  play: () => Promise<void>;
  pause: () => void;
  togglePlay: () => Promise<void>;
  retry: () => Promise<void>;
  setVolume: (value: number) => void;
  toggleMute: () => void;
  expandPlayer: () => void;
  collapsePlayer: () => void;
  setMetadata: (metadata: RadioMetadata) => void;
  bindAudio: (audio: HTMLAudioElement | null) => void;
  reportEngineEvent: (event: RadioEngineEvent) => void;
};

const RadioContext = createContext<RadioContextValue | null>(null);

export function RadioProvider({ children, station }: { children: ReactNode; station: RadioStationConfig }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const volumeRef = useRef(0.82);
  const mutedRef = useRef(false);
  const streamUrl = station.streamUrl.trim();
  const hasStream = station.enabled && station.published && streamUrl.length > 0;
  const storagePrefix = `clouva.radio.${station.id}`;
  const [status, setStatus] = useState<RadioStatus>(hasStream ? "IDLE" : "OFFLINE");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolumeState] = useState(0.82);
  const [expanded, setExpanded] = useState(false);
  const [metadata, setMetadata] = useState<RadioMetadata>(station.metadata);

  useEffect(() => {
    setMetadata(station.metadata);
    setIsPlaying(false);
    setStatus(hasStream ? "IDLE" : "OFFLINE");
  }, [hasStream, station.id, station.metadata]);

  useEffect(() => {
    try {
      const storedVolume = window.localStorage.getItem(`${storagePrefix}.volume`);
      const storedMuted = window.localStorage.getItem(`${storagePrefix}.muted`);
      const parsedVolume = storedVolume === null ? 0.82 : Number(storedVolume);
      if (Number.isFinite(parsedVolume)) {
        const nextVolume = Math.min(1, Math.max(0, parsedVolume));
        volumeRef.current = nextVolume;
        setVolumeState(nextVolume);
      }
      const nextMuted = storedMuted === "true";
      mutedRef.current = nextMuted;
      setIsMuted(nextMuted);
    } catch {
      // Persistence is best-effort. Playback remains usable without localStorage.
    }
  }, [storagePrefix]);

  const bindAudio = useCallback((audio: HTMLAudioElement | null) => {
    audioRef.current = audio;
    if (!audio) return;
    audio.volume = volumeRef.current;
    audio.muted = mutedRef.current;
  }, []);

  const reportEngineEvent = useCallback((event: RadioEngineEvent) => {
    switch (event) {
      case "connecting":
      case "waiting":
        setStatus("CONNECTING");
        break;
      case "playing":
        setIsPlaying(true);
        setStatus("LIVE");
        break;
      case "paused":
        setIsPlaying(false);
        setStatus(hasStream ? "IDLE" : "OFFLINE");
        break;
      case "error":
        setIsPlaying(false);
        setStatus(hasStream ? "ERROR" : "OFFLINE");
        break;
    }
  }, [hasStream]);

  const play = useCallback(async () => {
    if (!hasStream) {
      setStatus("OFFLINE");
      return;
    }
    const audio = audioRef.current;
    if (!audio) {
      setStatus("ERROR");
      return;
    }
    setStatus("CONNECTING");
    try {
      await audio.play();
    } catch {
      setIsPlaying(false);
      setStatus("ERROR");
    }
  }, [hasStream]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const togglePlay = useCallback(async () => {
    if (isPlaying) {
      pause();
      return;
    }
    await play();
  }, [isPlaying, pause, play]);

  const retry = useCallback(async () => {
    const audio = audioRef.current;
    if (audio && hasStream) audio.load();
    await play();
  }, [hasStream, play]);

  const setVolume = useCallback((value: number) => {
    const nextVolume = Math.min(1, Math.max(0, value));
    volumeRef.current = nextVolume;
    setVolumeState(nextVolume);
    if (audioRef.current) audioRef.current.volume = nextVolume;
    try {
      window.localStorage.setItem(`${storagePrefix}.volume`, String(nextVolume));
    } catch {
      // Persistence is best-effort.
    }
  }, [storagePrefix]);

  const toggleMute = useCallback(() => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setIsMuted(nextMuted);
    if (audioRef.current) audioRef.current.muted = nextMuted;
    try {
      window.localStorage.setItem(`${storagePrefix}.muted`, String(nextMuted));
    } catch {
      // Persistence is best-effort.
    }
  }, [storagePrefix]);

  const expandPlayer = useCallback(() => setExpanded(true), []);
  const collapsePlayer = useCallback(() => setExpanded(false), []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const mediaSession = navigator.mediaSession;
    mediaSession.metadata = new MediaMetadata({
      title: metadata.title || station.name,
      artist: metadata.artist || metadata.host || station.name,
      album: metadata.program || station.name,
      artwork: metadata.artwork ? [{ src: metadata.artwork }] : station.artworkUrl ? [{ src: station.artworkUrl }] : undefined,
    });
    mediaSession.playbackState = isPlaying ? "playing" : "paused";
    mediaSession.setActionHandler("play", () => void play());
    mediaSession.setActionHandler("pause", pause);
    return () => {
      mediaSession.setActionHandler("play", null);
      mediaSession.setActionHandler("pause", null);
    };
  }, [isPlaying, metadata, pause, play, station.artworkUrl, station.name]);

  const value = useMemo<RadioContextValue>(() => ({
    station,
    status,
    isPlaying,
    isMuted,
    volume,
    expanded,
    streamUrl,
    hasStream,
    metadata,
    play,
    pause,
    togglePlay,
    retry,
    setVolume,
    toggleMute,
    expandPlayer,
    collapsePlayer,
    setMetadata,
    bindAudio,
    reportEngineEvent,
  }), [station, status, isPlaying, isMuted, volume, expanded, streamUrl, hasStream, metadata, play, pause, togglePlay, retry, setVolume, toggleMute, expandPlayer, collapsePlayer, bindAudio, reportEngineEvent]);

  return <RadioContext.Provider value={value}>{children}</RadioContext.Provider>;
}

export function useRadio() {
  const context = useContext(RadioContext);
  if (!context) throw new Error("useRadio must be used inside RadioProvider");
  return context;
}
