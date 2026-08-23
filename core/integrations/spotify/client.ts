import { getSpotifyConfig } from "./config";
import type { SpotifyTokenResponse } from "./types";

export class SpotifyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = "SpotifyApiError";
  }
}

function basicAuth() {
  const config = getSpotifyConfig();
  return Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
}

async function tokenRequest(body: URLSearchParams): Promise<SpotifyTokenResponse> {
  const config = getSpotifyConfig();
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      authorization: `Basic ${basicAuth()}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as Partial<SpotifyTokenResponse> & { error_description?: string };
  if (!response.ok || !payload.access_token || !payload.expires_in) {
    throw new SpotifyApiError(payload.error_description || "Spotify rechazó la solicitud de token.", response.status);
  }
  return payload as SpotifyTokenResponse;
}

export function buildSpotifyAuthorizationUrl(state: string) {
  const config = getSpotifyConfig();
  const url = new URL(config.authorizationUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("show_dialog", "true");
  return url.toString();
}

export function exchangeSpotifyCode(code: string) {
  const config = getSpotifyConfig();
  return tokenRequest(new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  }));
}

export function refreshSpotifyToken(refreshToken: string) {
  return tokenRequest(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }));
}

export function getSpotifyAppAccessToken() {
  return tokenRequest(new URLSearchParams({ grant_type: "client_credentials" }));
}

async function wait(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function spotifyApiFetch<T>(options: {
  accessToken: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  retry429?: boolean;
}): Promise<T> {
  const config = getSpotifyConfig();
  const run = async () => {
    const response = await fetch(`${config.apiBaseUrl}${options.path}`, {
      method: options.method || "GET",
      headers: {
        authorization: `Bearer ${options.accessToken}`,
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
    });
    if (response.ok) {
      if (response.status === 204 || response.headers.get("content-length") === "0") return undefined as T;
      const text = await response.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : null;
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } | string };
    const message = typeof body.error === "string" ? body.error : body.error?.message;
    throw new SpotifyApiError(message || `Spotify API HTTP ${response.status}`, response.status, Number.isFinite(retryAfter) ? retryAfter : null);
  };

  try {
    return await run();
  } catch (error) {
    if (
      error instanceof SpotifyApiError &&
      error.status === 429 &&
      options.retry429 !== false &&
      error.retryAfter !== null &&
      error.retryAfter >= 0 &&
      error.retryAfter <= 5
    ) {
      await wait((error.retryAfter + 0.1) * 1000);
      return run();
    }
    throw error;
  }
}
