export const CLOUVA_YOUTUBE_REDIRECT_URI = "https://clouva.com.ar/api/integrations/youtube/callback";
const DEFAULT_SCOPES = ["https://www.googleapis.com/auth/youtube.readonly"];

function envFlag(value: string | undefined, fallback: boolean) {
  if (!value) return fallback;
  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

export function getYoutubeConfig() {
  const clientId = process.env.YOUTUBE_CLIENT_ID?.trim() || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || "";
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim() || "";
  const tokenEncryptionKey = process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY?.trim() || "";
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI?.trim() || CLOUVA_YOUTUBE_REDIRECT_URI;
  const scopes = (process.env.YOUTUBE_SCOPES || DEFAULT_SCOPES.join(" ")).split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean);
  return {
    clientId,
    clientSecret,
    tokenEncryptionKey,
    tokenKeyVersion: process.env.YOUTUBE_TOKEN_KEY_VERSION?.trim() || "v1",
    redirectUri,
    scopes,
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    apiBaseUrl: "https://www.googleapis.com/youtube/v3",
  };
}

export function isYoutubeEnabled() {
  if (!envFlag(process.env.CLOUVA_YOUTUBE_ENABLED, true)) return false;
  const config = getYoutubeConfig();
  return Boolean(config.clientId && config.clientSecret && config.tokenEncryptionKey);
}
