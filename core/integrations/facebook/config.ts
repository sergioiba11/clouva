export const CLOUVA_FACEBOOK_REDIRECT_URI = "https://clouva.com.ar/api/integrations/facebook/callback";

export function getFacebookConfig() {
  return {
    appId: process.env.FACEBOOK_APP_ID?.trim() || "",
    appSecret: process.env.FACEBOOK_APP_SECRET?.trim() || "",
    tokenEncryptionKey: process.env.FACEBOOK_TOKEN_ENCRYPTION_KEY?.trim() || "",
    tokenKeyVersion: process.env.FACEBOOK_TOKEN_KEY_VERSION?.trim() || "v1",
    redirectUri: process.env.FACEBOOK_REDIRECT_URI?.trim() || CLOUVA_FACEBOOK_REDIRECT_URI,
    graphVersion: process.env.FACEBOOK_GRAPH_VERSION?.trim() || "v26.0",
    scopes: (process.env.FACEBOOK_SCOPES || "public_profile,pages_show_list,pages_manage_posts,pages_read_engagement")
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

export function isFacebookEnabled() {
  const config = getFacebookConfig();
  return Boolean(config.appId && config.appSecret && config.tokenEncryptionKey);
}
