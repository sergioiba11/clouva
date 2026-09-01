import { getYoutubeConfig } from "./config";
import type { YoutubeTokenResponse } from "./types";

export class YoutubeApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "YoutubeApiError";
  }
}

async function tokenRequest(body: URLSearchParams): Promise<YoutubeTokenResponse> {
  const config = getYoutubeConfig();
  body.set("client_id", config.clientId);
  body.set("client_secret", config.clientSecret);
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as Partial<YoutubeTokenResponse> & { error_description?: string; error?: string };
  if (!response.ok || !payload.access_token || !payload.expires_in) {
    throw new YoutubeApiError(payload.error_description || payload.error || "Google rechazó la solicitud de token.", response.status);
  }
  return payload as YoutubeTokenResponse;
}

export function buildYoutubeAuthorizationUrl(state: string) {
  const config = getYoutubeConfig();
  const url = new URL(config.authorizationUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export function exchangeYoutubeCode(code: string) {
  const config = getYoutubeConfig();
  return tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: config.redirectUri }));
}

export function refreshYoutubeToken(refreshToken: string) {
  return tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }));
}

export async function youtubeApiFetch<T>(options: { accessToken: string; path: string }): Promise<T> {
  const config = getYoutubeConfig();
  const response = await fetch(`${config.apiBaseUrl}${options.path}`, {
    headers: { authorization: `Bearer ${options.accessToken}` },
    cache: "no-store",
  });
  if (response.ok) return await response.json() as T;
  const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  throw new YoutubeApiError(payload.error?.message || `YouTube API HTTP ${response.status}`, response.status);
}
