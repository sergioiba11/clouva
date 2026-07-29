import { getInstagramConfig } from "./config";
import type {
  InstagramImportSnapshot,
  InstagramLongLivedTokenResponse,
  InstagramMediaPage,
  InstagramProfile,
  InstagramTokenResponse,
} from "./types";

async function parseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string } | string;
    error_message?: string;
  };

  if (!response.ok) {
    const nested = typeof payload.error === "object" ? payload.error?.message : payload.error;
    throw new Error(nested || payload.error_message || `Instagram respondió HTTP ${response.status}.`);
  }
  return payload;
}

export function buildInstagramAuthorizeUrl(state: string) {
  const config = getInstagramConfig();
  const url = new URL(config.authorizationUrl);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scopes.join(","));
  url.searchParams.set("state", state);
  url.searchParams.set("enable_fb_login", "0");
  url.searchParams.set("force_authentication", "1");
  return url.toString();
}

export async function exchangeAuthorizationCode(code: string) {
  const config = getInstagramConfig();
  const body = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
    code,
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  return parseJson<InstagramTokenResponse>(response);
}

export async function exchangeLongLivedToken(shortLivedToken: string) {
  const config = getInstagramConfig();
  const url = new URL(config.longLivedTokenUrl);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("access_token", shortLivedToken);

  const response = await fetch(url, { cache: "no-store" });
  return parseJson<InstagramLongLivedTokenResponse>(response);
}

export async function fetchInstagramSnapshot(accessToken: string, fallbackUserId?: string) {
  const config = getInstagramConfig();
  const base = config.graphBaseUrl.replace(/\/$/, "");
  const profileUrl = new URL(`${base}/me`);
  profileUrl.searchParams.set(
    "fields",
    "id,user_id,username,name,account_type,profile_picture_url,followers_count,media_count,biography",
  );
  profileUrl.searchParams.set("access_token", accessToken);

  const profile = await parseJson<InstagramProfile>(
    await fetch(profileUrl, { cache: "no-store" }),
  );

  const accountId = profile.user_id || profile.id || fallbackUserId;
  if (!accountId) throw new Error("Instagram no devolvió un identificador de cuenta.");

  const mediaUrl = new URL(`${base}/${encodeURIComponent(accountId)}/media`);
  mediaUrl.searchParams.set(
    "fields",
    "id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,username",
  );
  mediaUrl.searchParams.set("limit", "50");
  mediaUrl.searchParams.set("access_token", accessToken);

  const mediaPage = await parseJson<InstagramMediaPage>(
    await fetch(mediaUrl, { cache: "no-store" }),
  );

  return {
    profile: { ...profile, id: accountId },
    media: Array.isArray(mediaPage.data) ? mediaPage.data : [],
  } satisfies InstagramImportSnapshot;
}
