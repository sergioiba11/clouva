import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import type { SpotifyPendingAction, SpotifyPublicConnection } from "@/core/integrations/spotify/types";

export async function getSpotifyConnectionStatus() {
  const response = await authenticatedFetch("/api/integrations/spotify/status", { method: "GET" });
  return readApiJson<{ ok: true; enabled: boolean; connection: SpotifyPublicConnection }>(response);
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
