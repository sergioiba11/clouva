import { createClient } from "@supabase/supabase-js";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const spotifyAccountsUrl = "https://accounts.spotify.com";
const spotifyApiUrl = "https://api.spotify.com/v1";

export const spotifyScopes = [
  "user-read-email",
  "user-read-private",
  "user-top-read",
  "user-read-recently-played",
  "user-read-currently-playing",
  "user-read-playback-state",
].join(" ");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

export function getSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function getSpotifyRedirectUri(): string {
  return process.env.SPOTIFY_REDIRECT_URI || `${getSiteUrl()}/api/spotify/callback`;
}

export function getAdminSupabase() {
  return createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireSupabaseUser(request: Request) {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new Error("UNAUTHORIZED");

  const supabase = getAdminSupabase();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error("UNAUTHORIZED");
  return data.user;
}

function stateSecret(): string {
  return process.env.SPOTIFY_STATE_SECRET || required("SPOTIFY_CLIENT_SECRET");
}

export function createSpotifyState(userId: string): string {
  const payload = Buffer.from(JSON.stringify({ userId, nonce: randomBytes(18).toString("hex"), exp: Date.now() + 10 * 60_000 })).toString("base64url");
  const signature = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySpotifyState(state: string): { userId: string } {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) throw new Error("INVALID_STATE");
  const expected = createHmac("sha256", stateSecret()).update(payload).digest();
  const received = Buffer.from(signature, "base64url");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error("INVALID_STATE");
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { userId: string; exp: number };
  if (!parsed.userId || parsed.exp < Date.now()) throw new Error("INVALID_STATE");
  return { userId: parsed.userId };
}

export function buildSpotifyAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: required("SPOTIFY_CLIENT_ID"),
    response_type: "code",
    redirect_uri: getSpotifyRedirectUri(),
    scope: spotifyScopes,
    state,
    show_dialog: "true",
  });
  return `${spotifyAccountsUrl}/authorize?${params}`;
}

export async function exchangeSpotifyCode(code: string) {
  const response = await fetch(`${spotifyAccountsUrl}/api/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${required("SPOTIFY_CLIENT_ID")}:${required("SPOTIFY_CLIENT_SECRET")}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: getSpotifyRedirectUri() }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`SPOTIFY_TOKEN_EXCHANGE_${response.status}`);
  return response.json() as Promise<{ access_token: string; token_type: string; scope: string; expires_in: number; refresh_token: string }>;
}

async function refreshSpotifyToken(refreshToken: string) {
  const response = await fetch(`${spotifyAccountsUrl}/api/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${required("SPOTIFY_CLIENT_ID")}:${required("SPOTIFY_CLIENT_SECRET")}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`SPOTIFY_REFRESH_${response.status}`);
  return response.json() as Promise<{ access_token: string; expires_in: number; refresh_token?: string; scope?: string }>;
}

export async function getValidSpotifyAccessToken(userId: string): Promise<string> {
  const supabase = getAdminSupabase();
  const { data, error } = await supabase.from("spotify_connections").select("access_token, refresh_token, token_expires_at").eq("user_id", userId).single();
  if (error || !data) throw new Error("SPOTIFY_NOT_CONNECTED");

  if (new Date(data.token_expires_at).getTime() > Date.now() + 60_000) return data.access_token;
  if (!data.refresh_token) throw new Error("SPOTIFY_RECONNECT_REQUIRED");

  const refreshed = await refreshSpotifyToken(data.refresh_token);
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  const { error: updateError } = await supabase.from("spotify_connections").update({
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || data.refresh_token,
    token_expires_at: expiresAt,
    scopes: refreshed.scope ? refreshed.scope.split(" ") : undefined,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  if (updateError) throw updateError;
  return refreshed.access_token;
}

export async function spotifyFetch<T>(userId: string, path: string): Promise<T | null> {
  const accessToken = await getValidSpotifyAccessToken(userId);
  const response = await fetch(`${spotifyApiUrl}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`SPOTIFY_API_${response.status}`);
  return response.json() as Promise<T>;
}
