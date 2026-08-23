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

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} no está configurada.`);
  return value;
}

export function isSpotifyEnabled() {
  return process.env.CLOUVA_SPOTIFY_ENABLED === "true";
}

export function getSpotifyConfig(): SpotifyConfig {
  return {
    clientId: required("SPOTIFY_CLIENT_ID"),
    clientSecret: required("SPOTIFY_CLIENT_SECRET"),
    redirectUri:
      process.env.SPOTIFY_REDIRECT_URI?.trim() ||
      "https://clouva.com.ar/api/integrations/spotify/callback",
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
