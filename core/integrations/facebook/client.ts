import { getFacebookConfig } from "./config";

type GraphError = { error?: { message?: string; type?: string; code?: number } };

async function graphJson<T>(url: URL, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({})) as T & GraphError;
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || "Facebook Graph API respondió con error " + response.status + ".");
  }
  return payload;
}

export function facebookAuthorizationUrl(state: string) {
  const config = getFacebookConfig();
  const url = new URL("https://www.facebook.com/" + config.graphVersion + "/dialog/oauth");
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", config.scopes.join(","));
  url.searchParams.set("response_type", "code");
  return url.toString();
}

export async function exchangeFacebookCode(code: string) {
  const config = getFacebookConfig();
  const url = new URL("https://graph.facebook.com/" + config.graphVersion + "/oauth/access_token");
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("code", code);
  const short = await graphJson<{ access_token: string; token_type?: string; expires_in?: number }>(url);

  const exchange = new URL("https://graph.facebook.com/" + config.graphVersion + "/oauth/access_token");
  exchange.searchParams.set("grant_type", "fb_exchange_token");
  exchange.searchParams.set("client_id", config.appId);
  exchange.searchParams.set("client_secret", config.appSecret);
  exchange.searchParams.set("fb_exchange_token", short.access_token);

  try {
    return await graphJson<{ access_token: string; token_type?: string; expires_in?: number }>(exchange);
  } catch {
    return short;
  }
}

export async function fetchFacebookIdentity(accessToken: string) {
  const config = getFacebookConfig();
  const me = new URL("https://graph.facebook.com/" + config.graphVersion + "/me");
  me.searchParams.set("fields", "id,name");
  me.searchParams.set("access_token", accessToken);
  return graphJson<{ id: string; name: string }>(me);
}

export async function fetchFacebookPages(accessToken: string) {
  const config = getFacebookConfig();
  const url = new URL("https://graph.facebook.com/" + config.graphVersion + "/me/accounts");
  url.searchParams.set("fields", "id,name,access_token,tasks");
  url.searchParams.set("limit", "100");
  url.searchParams.set("access_token", accessToken);
  const payload = await graphJson<{
    data?: Array<{ id: string; name: string; access_token?: string; tasks?: string[] }>;
  }>(url);
  return payload.data ?? [];
}

export async function publishFacebookPagePost(options: {
  pageId: string;
  pageAccessToken: string;
  message: string;
  imageUrls: string[];
}) {
  const config = getFacebookConfig();
  const mediaIds: string[] = [];

  for (const imageUrl of options.imageUrls.slice(0, 10)) {
    const photoUrl = new URL("https://graph.facebook.com/" + config.graphVersion + "/" + encodeURIComponent(options.pageId) + "/photos");
    const body = new URLSearchParams({
      url: imageUrl,
      published: "false",
      access_token: options.pageAccessToken,
    });
    const photo = await graphJson<{ id: string }>(photoUrl, { method: "POST", body });
    if (photo.id) mediaIds.push(photo.id);
  }

  const feedUrl = new URL("https://graph.facebook.com/" + config.graphVersion + "/" + encodeURIComponent(options.pageId) + "/feed");
  const body = new URLSearchParams({
    message: options.message,
    access_token: options.pageAccessToken,
  });
  if (mediaIds.length) {
    body.set("attached_media", JSON.stringify(mediaIds.map((media_fbid) => ({ media_fbid }))));
  }
  const post = await graphJson<{ id: string }>(feedUrl, { method: "POST", body });
  return {
    externalId: post.id,
    externalUrl: post.id ? "https://www.facebook.com/" + post.id.replace("_", "/posts/") : null,
  };
}
