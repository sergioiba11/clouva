import "server-only";

type KickTokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number | string;
};

type KickChannelResponse = {
  data?: Array<{
    slug?: string;
    stream_title?: string | null;
    stream?: {
      is_live?: boolean;
      start_time?: string | null;
      thumbnail?: string | null;
      viewer_count?: number | null;
      url?: string | null;
    } | null;
  }>;
};

export type ActiveKickLive = {
  platform: "kick";
  slug: string;
  title: string;
  watchUrl: string;
  startedAt: string | null;
  thumbnailUrl: string | null;
  viewerCount: number | null;
};

let appTokenCache: { token: string; expiresAt: number } | null = null;

function kickEnabled() {
  return process.env.CLOUVA_KICK_ENABLED !== "false";
}

export function kickSlugFromUrl(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (!/(^|\.)kick\.com$/i.test(url.hostname)) return null;
    const slug = url.pathname.split("/").filter(Boolean)[0] || "";
    return /^[a-z0-9_-]{1,25}$/i.test(slug) ? slug : null;
  } catch {
    return /^[a-z0-9_-]{1,25}$/i.test(trimmed) ? trimmed : null;
  }
}

async function getKickAppAccessToken() {
  if (!kickEnabled()) return null;
  const clientId = process.env.KICK_CLIENT_ID?.trim();
  const clientSecret = process.env.KICK_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  if (appTokenCache && Date.now() < appTokenCache.expiresAt) return appTokenCache.token;

  const response = await fetch("https://id.kick.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: "no-store",
  });
  if (!response.ok) return null;

  const payload = (await response.json().catch(() => ({}))) as KickTokenResponse;
  if (!payload.access_token) return null;

  const expiresIn = Number(payload.expires_in || 3600);
  appTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  };
  return payload.access_token;
}

export async function getActiveKickLive(
  channelUrl: string | null | undefined,
): Promise<ActiveKickLive | null> {
  const slug = kickSlugFromUrl(channelUrl);
  if (!slug) return null;

  const token = await getKickAppAccessToken();
  if (!token) return null;

  const response = await fetch(
    `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(slug)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  if (!response.ok) return null;

  const payload = (await response.json().catch(() => ({}))) as KickChannelResponse;
  const channel = payload.data?.[0];
  const stream = channel?.stream;
  if (!channel || !stream?.is_live) return null;

  const resolvedSlug = channel.slug || slug;
  return {
    platform: "kick",
    slug: resolvedSlug,
    title: channel.stream_title?.trim() || `${resolvedSlug} en vivo`,
    watchUrl: `https://kick.com/${encodeURIComponent(resolvedSlug)}`,
    startedAt: stream.start_time || null,
    thumbnailUrl: stream.thumbnail || null,
    viewerCount: typeof stream.viewer_count === "number" ? stream.viewer_count : null,
  };
}
