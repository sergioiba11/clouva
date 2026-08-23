import { SpotifyApiError } from "./client";
import { SpotifyConnectionError } from "./service";

export function spotifyErrorPayload(error: unknown) {
  if (error instanceof SpotifyConnectionError) {
    return { status: error.code === "spotify_connection_required" ? 409 : 401, body: { ok: false, code: error.code } };
  }
  if (error instanceof SpotifyApiError) {
    if (error.status === 429) return { status: 429, body: { ok: false, code: "spotify_rate_limited" } };
    if (error.status === 403) return { status: 403, body: { ok: false, code: "spotify_permission_missing" } };
    if (error.status === 401) return { status: 401, body: { ok: false, code: "spotify_reconnect_required" } };
    return { status: 502, body: { ok: false, code: "spotify_api_error" } };
  }
  if (error instanceof Error && error.message === "spotify_disabled") {
    return { status: 503, body: { ok: false, code: "spotify_disabled" } };
  }
  return { status: 500, body: { ok: false, code: "spotify_api_error" } };
}
