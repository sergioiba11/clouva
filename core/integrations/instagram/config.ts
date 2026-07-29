export type InstagramConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  apiVersion: string;
  authorizationUrl: string;
  tokenUrl: string;
  longLivedTokenUrl: string;
  graphBaseUrl: string;
  scopes: string[];
  tokenKeyVersion: string;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} no está configurada.`);
  return value;
}

export function getInstagramConfig(): InstagramConfig {
  const apiVersion = process.env.INSTAGRAM_API_VERSION?.trim() || "v25.0";
  return {
    appId: required("INSTAGRAM_APP_ID"),
    appSecret: required("INSTAGRAM_APP_SECRET"),
    redirectUri:
      process.env.INSTAGRAM_REDIRECT_URI?.trim() ||
      "https://clouva.com.ar/api/integrations/instagram/callback",
    apiVersion,
    authorizationUrl:
      process.env.INSTAGRAM_AUTHORIZATION_URL?.trim() ||
      "https://www.instagram.com/oauth/authorize",
    tokenUrl:
      process.env.INSTAGRAM_TOKEN_URL?.trim() ||
      "https://api.instagram.com/oauth/access_token",
    longLivedTokenUrl:
      process.env.INSTAGRAM_LONG_LIVED_TOKEN_URL?.trim() ||
      "https://graph.instagram.com/access_token",
    graphBaseUrl:
      process.env.INSTAGRAM_GRAPH_BASE_URL?.trim() ||
      `https://graph.instagram.com/${apiVersion}`,
    scopes: (process.env.INSTAGRAM_SCOPES || "instagram_business_basic")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
    tokenKeyVersion: process.env.INSTAGRAM_TOKEN_KEY_VERSION?.trim() || "v1",
  };
}

export function isInstagramEnabled() {
  return process.env.CLOUVA_INSTAGRAM_IMPORT_ENABLED === "true";
}
