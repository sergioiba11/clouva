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
import { IGLU_RADIO_STREAM_URL } from "@/lib/iglu-radio/config";
import {
  DEFAULT_IGLU_RADIO_METADATA,
  type IgluRadioMetadata,
  type IgluRadioStatus,
} from "@/lib/iglu-radio/types";

type EngineEvent = "connecting" | "playing" | "paused" | "waiting" | "error";

type RadioContextValue = {
  status: IgluRadioStatus;
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  expanded: boolean;
  streamUrl: string;
  hasStream: boolean;
  metadata: IgluRadioMetadata;
  play: () => Promise<void>;
  pause: () => void;
  togglePlay: () => Promise<void>;
  retry: () => Promise<void>;
  setVolume: (value: number) => void;
  toggleMute: () => void;
  expandPlayer: () => void;
  collapsePlayer: () => void;
  setMetadata: (metadata: IgluRadioMetadata) => void;
  bindAudio: (audio: HTMLAudioElement | null) => void;
  reportEngineEvent: (event: EngineEvent) => void;
};

const RadioContext = createContext<RadioContextValue | null>(null);
const VOLUME_STORAGE_KEY = "clouva.iglu-radio.volume";
const MUTED_STORAGE_KEY = "clouva.iglu-radio.muted";

export function RadioProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const volumeRef = useRef(0.82);
  const mutedRef = useRef(false);
  const hasStream = IGLU_RADIO_STREAM_URL.length > 0;
  const [status, setStatus] = useState<IgluRadioStatus>(hasStream ? "IDLE" : "OFFLINE");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolumeState] = useState(0.82);
  const [expanded, setExpanded] = useState(false);
  const [metadata, setMetadata] = useState<IgluRadioMetadata>(DEFAULT_IGLU_RADIO_METADATA);

  useEffect(() => {
    try {
      const storedVolume = window.localStorage.getItem(VOLUME_STORAGE_KEY);
      const storedMuted = window.localStorage.getItem(MUTED_STORAGE_KEY);
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
      // localStorage is optional; radio remains fully usable without persistence.
    }
  }, []);

  const bindAudio = useCallback((audio: HTMLAudioElement | null) => {
    audioRef.current = audio;
    if (!audio) return;
    audio.volume = volumeRef.current;
    audio.muted = mutedRef.current;
  }, []);

  const reportEngineEvent = useCallback((event: EngineEvent) => {
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
    if (audio && hasStream) {
      audio.load();
    }
    await play();
  }, [hasStream, play]);

  const setVolume = useCallback((value: number) => {
    const nextVolume = Math.min(1, Math.max(0, value));
    volumeRef.current = nextVolume;
    setVolumeState(nextVolume);
    if (audioRef.current) audioRef.current.volume = nextVolume;
    try {
      window.localStorage.setItem(VOLUME_STORAGE_KEY, String(nextVolume));
    } catch {
      // Persistence is best-effort.
    }
  }, []);

  const toggleMute = useCallback(() => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setIsMuted(nextMuted);
    if (audioRef.current) audioRef.current.muted = nextMuted;
    try {
      window.localStorage.setItem(MUTED_STORAGE_KEY, String(nextMuted));
    } catch {
      // Persistence is best-effort.
    }
  }, []);

  const expandPlayer = useCallback(() => setExpanded(true), []);
  const collapsePlayer = useCallback(() => setExpanded(false), []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const mediaSession = navigator.mediaSession;
    mediaSession.metadata = new MediaMetadata({
      title: metadata.title || "IGLÚ RADIO",
      artist: metadata.artist || metadata.host || "IGLÚ RECORDS",
      album: metadata.program || "IGLÚ RADIO",
      artwork: metadata.artwork ? [{ src: metadata.artwork }] : undefined,
    });
    mediaSession.playbackState = isPlaying ? "playing" : "paused";
    mediaSession.setActionHandler("play", () => void play());
    mediaSession.setActionHandler("pause", pause);
    return () => {
      mediaSession.setActionHandler("play", null);
      mediaSession.setActionHandler("pause", null);
    };
  }, [isPlaying, metadata, pause, play]);

  const value = useMemo<RadioContextValue>(() => ({
    status,
    isPlaying,
    isMuted,
    volume,
    expanded,
    streamUrl: IGLU_RADIO_STREAM_URL,
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
  }), [
    bindAudio,
    collapsePlayer,
    expandPlayer,
    hasStream,
    isMuted,
    isPlaying,
    metadata,
    pause,
    play,
    reportEngineEvent,
    retry,
    setVolume,
    status,
    toggleMute,
    togglePlay,
    volume,
  ]);

  return <RadioContext.Provider value={value}>{children}</RadioContext.Provider>;
}

export function useIgluRadio() {
  const context = useContext(RadioContext);
  if (!context) throw new Error("useIgluRadio must be used inside RadioProvider");
  return context;
}
