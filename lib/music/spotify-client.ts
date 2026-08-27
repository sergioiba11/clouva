import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import type { SpotifyPendingAction, SpotifyPublicConnection } from "@/core/integrations/spotify/types";

export type SpotifyPlaybackAction = "play" | "pause" | "next" | "previous";

export type SpotifyPlaybackState = {
  isPlaying: boolean;
  progressMs: number;
  durationMs: number;
  device: {
    id: string | null;
    name: string | null;
    type: string | null;
    isActive: boolean;
    volumePercent: number | null;
  } | null;
  track: {
    id: string;
    uri: string | null;
    title: string;
    artist: string;
    album: string | null;
    albumId: string | null;
    coverUrl: string | null;
    externalUrl: string | null;
  };
};

export type SpotifyPlaybackSnapshot = {
  ok: true;
  enabled: boolean;
  connected: boolean;
  scopesReady: boolean;
  connection?: SpotifyPublicConnection;
  playback: SpotifyPlaybackState | null;
};

export async function getSpotifyConnectionStatus() {
  const response = await authenticatedFetch("/api/integrations/spotify/status", { method: "GET" });
  return readApiJson<{ ok: true; enabled: boolean; connection: SpotifyPublicConnection }>(response);
}

export async function getSpotifyPlaybackState() {
  const response = await authenticatedFetch("/api/integrations/spotify/playback", { method: "GET" });
  return readApiJson<SpotifyPlaybackSnapshot>(response);
}

export async function controlSpotifyPlayback(action: SpotifyPlaybackAction) {
  const response = await authenticatedFetch("/api/integrations/spotify/playback", {
    method: "POST",
    body: JSON.stringify({ action }),
  });
  return readApiJson<{ ok: true; action: SpotifyPlaybackAction }>(response);
}

export async function startSpotifyConnection(options: { returnPath: string; pendingAction?: SpotifyPendingAction }) {
  const response = await authenticatedFetch("/api/integrations/spotify/connect", {
    method: "POST",
    body: JSON.stringify(options),
  });
  const payload = await readApiJson<{ ok: true; authorizeUrl: string }>(response);
  window.location.assign(payload.authorizeUrl);
}

export async function disconnectSpotifyConnection() {
  const response = await authenticatedFetch("/api/integrations/spotify/disconnect", { method: "POST" });
  return readApiJson<{ ok: true; connected: false }>(response);
}
