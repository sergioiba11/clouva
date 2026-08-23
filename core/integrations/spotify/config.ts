export type SpotifyConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  authorizationUrl: string;
  tokenUrl: string;
  apiBaseUrl: string;
  tokenKeyVersion: string;
};

// Public identifier for the official CLOUVA Spotify developer app.
// This value is intentionally safe to keep in source; the client secret remains runtime-only.
export const CLOUVA_SPOTIFY_CLIENT_ID = "769cdc52f22d43c29cf3c69da14e5d79";
export const CLOUVA_SPOTIFY_REDIRECT_URI = "https://clouva.com.ar/api/integrations/spotify/callback";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} no está configurada.`);
  return value;
}

export function isSpotifyEnabled() {
  const explicit = process.env.CLOUVA_SPOTIFY_ENABLED?.trim();
  if (explicit === "false") return false;
  if (explicit === "true") return true;

  // Production becomes ready automatically once the two private runtime secrets exist.
  // This avoids requiring another non-secret Cloud Run flag after provisioning secrets.
  return Boolean(
    process.env.SPOTIFY_CLIENT_SECRET?.trim() &&
    process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY?.trim(),
  );
}

export function getSpotifyConfig(): SpotifyConfig {
  return {
    clientId: process.env.SPOTIFY_CLIENT_ID?.trim() || CLOUVA_SPOTIFY_CLIENT_ID,
    clientSecret: required("SPOTIFY_CLIENT_SECRET"),
    redirectUri: process.env.SPOTIFY_REDIRECT_URI?.trim() || CLOUVA_SPOTIFY_REDIRECT_URI,
    scopes: (process.env.SPOTIFY_SCOPES || "user-library-read,user-library-modify,user-follow-read,user-follow-modify")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
    authorizationUrl: process.env.SPOTIFY_AUTHORIZATION_URL?.trim() || "https://accounts.spotify.com/authorize",
    tokenUrl: process.env.SPOTIFY_TOKEN_URL?.trim() || "https://accounts.spotify.com/api/token",
    apiBaseUrl: process.env.SPOTIFY_API_BASE_URL?.trim() || "https://api.spotify.com/v1",
    tokenKeyVersion: process.env.SPOTIFY_TOKEN_KEY_VERSION?.trim() || "v1",
  };
}
