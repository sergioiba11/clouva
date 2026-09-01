import type { SupabaseClient } from "@supabase/supabase-js";
import { getYoutubeConfig, isYoutubeEnabled } from "./config";
import { decryptYoutubeSecret, encryptYoutubeSecret } from "./crypto";
import { refreshYoutubeToken, YoutubeApiError, youtubeApiFetch } from "./client";
import type { YoutubeChannel, YoutubePlaylistItem, YoutubePublicConnection, YoutubeTokenResponse } from "./types";

type ConnectionRow = {
  id: string;
  user_id: string | null;
  external_account_id: string;
  external_username: string | null;
  display_name: string | null;
  access_token_ciphertext: string | null;
  token_iv: string | null;
  token_auth_tag: string | null;
  refresh_token_ciphertext: string | null;
  refresh_token_iv: string | null;
  refresh_token_auth_tag: string | null;
  expires_at: string | null;
  scopes: string[] | null;
  status: string;
  metadata: Record<string, unknown> | null;
  connected_at: string | null;
  last_synced_at: string | null;
};

const connectionSelect = [
  "id,user_id,external_account_id,external_username,display_name",
  "access_token_ciphertext,token_iv,token_auth_tag",
  "refresh_token_ciphertext,refresh_token_iv,refresh_token_auth_tag",
  "expires_at,scopes,status,metadata,connected_at,last_synced_at",
].join(",");

function thumbnail(channel: YoutubeChannel) {
  const thumbnails = channel.snippet?.thumbnails || {};
  return thumbnails.high?.url || thumbnails.medium?.url || thumbnails.default?.url || null;
}

function channelHandle(channel: YoutubeChannel) {
  const value = channel.snippet?.customUrl?.trim() || "";
  if (!value) return null;
  return value.startsWith("@") ? value : `@${value.replace(/^@+/, "")}`;
}

function channelUrl(channel: YoutubeChannel) {
  const handle = channelHandle(channel);
  return handle ? `https://www.youtube.com/${handle}` : `https://www.youtube.com/channel/${channel.id}`;
}

async function editablePlayerId(admin: SupabaseClient, userId: string) {
  const { data: owned, error: ownedError } = await admin.from("players").select("id").eq("owner_user_id", userId).maybeSingle();
  if (ownedError) throw new Error(ownedError.message);
  if (owned?.id) return String(owned.id);

  const { data: member, error: memberError } = await admin
    .from("player_members")
    .select("player_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .in("role", ["owner", "manager", "editor"])
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  return member?.player_id ? String(member.player_id) : null;
}

export async function loadYoutubeConnection(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin
    .from("social_connections")
    .select(connectionSelect)
    .eq("provider", "youtube")
    .eq("user_id", userId)
    .in("status", ["active", "expired"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer YouTube: ${error.message}`);
  return data as ConnectionRow | null;
}

function decryptAccess(row: ConnectionRow) {
  if (!row.access_token_ciphertext || !row.token_iv || !row.token_auth_tag) throw new Error("youtube_reconnect_required");
  return decryptYoutubeSecret({ ciphertext: row.access_token_ciphertext, iv: row.token_iv, authTag: row.token_auth_tag });
}

function decryptRefresh(row: ConnectionRow) {
  if (!row.refresh_token_ciphertext || !row.refresh_token_iv || !row.refresh_token_auth_tag) throw new Error("youtube_reconnect_required");
  return decryptYoutubeSecret({ ciphertext: row.refresh_token_ciphertext, iv: row.refresh_token_iv, authTag: row.refresh_token_auth_tag });
}

export async function persistYoutubeConnection(options: { admin: SupabaseClient; userId: string; tokens: YoutubeTokenResponse; channel: YoutubeChannel }) {
  const { admin, userId, tokens, channel } = options;
  const { data: existing, error: existingError } = await admin
    .from("social_connections")
    .select(connectionSelect)
    .eq("provider", "youtube")
    .eq("external_account_id", channel.id)
    .maybeSingle();
  if (existingError) throw new Error(`No se pudo validar la cuenta YouTube: ${existingError.message}`);
  if (existing?.user_id && existing.user_id !== userId && existing.status === "active") throw new Error("Este canal de YouTube ya está conectado a otro usuario CLOUVA.");

  const config = getYoutubeConfig();
  const access = encryptYoutubeSecret(tokens.access_token);
  const refresh = tokens.refresh_token ? encryptYoutubeSecret(tokens.refresh_token) : null;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.max(1, tokens.expires_in) * 1000).toISOString();
  const metadata = {
    channel_url: channelUrl(channel),
    thumbnail_url: thumbnail(channel),
    uploads_playlist_id: channel.contentDetails?.relatedPlaylists?.uploads || null,
  };
  const row: Record<string, unknown> = {
    user_id: userId,
    studio_id: null,
    provider: "youtube",
    external_account_id: channel.id,
    external_username: channelHandle(channel),
    display_name: channel.snippet?.title || channel.id,
    account_type: "channel",
    access_token_ciphertext: access.ciphertext,
    token_iv: access.iv,
    token_auth_tag: access.authTag,
    token_key_version: config.tokenKeyVersion,
    expires_at: expiresAt,
    scopes: (tokens.scope || config.scopes.join(" ")).split(/\s+/).filter(Boolean),
    status: "active",
    metadata,
    connected_at: existing?.connected_at || now,
    last_synced_at: existing?.last_synced_at || null,
    updated_at: now,
  };
  if (refresh) {
    row.refresh_token_ciphertext = refresh.ciphertext;
    row.refresh_token_iv = refresh.iv;
    row.refresh_token_auth_tag = refresh.authTag;
  }

  if (existing?.id) {
    const { error } = await admin.from("social_connections").update(row).eq("id", existing.id);
    if (error) throw new Error(`No se pudo guardar YouTube: ${error.message}`);
    return existing.id;
  }
  const { data, error } = await admin.from("social_connections").insert(row).select("id").single();
  if (error) throw new Error(`No se pudo guardar YouTube: ${error.message}`);
  return String(data.id);
}

async function refreshConnection(admin: SupabaseClient, row: ConnectionRow) {
  const tokens = await refreshYoutubeToken(decryptRefresh(row));
  const access = encryptYoutubeSecret(tokens.access_token);
  const expiresAt = new Date(Date.now() + Math.max(1, tokens.expires_in) * 1000).toISOString();
  const patch: Record<string, unknown> = {
    access_token_ciphertext: access.ciphertext,
    token_iv: access.iv,
    token_auth_tag: access.authTag,
    expires_at: expiresAt,
    status: "active",
    updated_at: new Date().toISOString(),
  };
  if (tokens.scope) patch.scopes = tokens.scope.split(/\s+/).filter(Boolean);
  if (tokens.refresh_token) {
    const refresh = encryptYoutubeSecret(tokens.refresh_token);
    patch.refresh_token_ciphertext = refresh.ciphertext;
    patch.refresh_token_iv = refresh.iv;
    patch.refresh_token_auth_tag = refresh.authTag;
  }
  const { error } = await admin.from("social_connections").update(patch).eq("id", row.id);
  if (error) throw new Error(`No se pudo refrescar YouTube: ${error.message}`);
  return tokens.access_token;
}

export async function getYoutubeUserAccessToken(admin: SupabaseClient, userId: string) {
  if (!isYoutubeEnabled()) throw new Error("youtube_disabled");
  const row = await loadYoutubeConnection(admin, userId);
  if (!row) throw new Error("youtube_connection_required");
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (!expiresAt || expiresAt <= Date.now() + 60_000 || row.status === "expired") {
    try {
      return await refreshConnection(admin, row);
    } catch {
      await admin.from("social_connections").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", row.id);
      throw new Error("youtube_reconnect_required");
    }
  }
  return decryptAccess(row);
}

async function youtubeUserApi<T>(admin: SupabaseClient, userId: string, path: string) {
  const token = await getYoutubeUserAccessToken(admin, userId);
  try {
    return await youtubeApiFetch<T>({ accessToken: token, path });
  } catch (error) {
    if (error instanceof YoutubeApiError && error.status === 401) {
      const row = await loadYoutubeConnection(admin, userId);
      if (!row) throw new Error("youtube_connection_required");
      const refreshed = await refreshConnection(admin, row).catch(() => null);
      if (!refreshed) throw new Error("youtube_reconnect_required");
      return youtubeApiFetch<T>({ accessToken: refreshed, path });
    }
    throw error;
  }
}

export async function fetchYoutubeChannelWithAccessToken(accessToken: string) {
  const response = await youtubeApiFetch<{ items?: YoutubeChannel[] }>({ accessToken, path: "/channels?part=snippet,contentDetails&mine=true&maxResults=1" });
  const channel = response.items?.[0];
  if (!channel?.id) throw new Error("Google no devolvió un canal de YouTube para esta cuenta.");
  return channel;
}

export async function syncYoutubeVideos(admin: SupabaseClient, userId: string) {
  const channelResponse = await youtubeUserApi<{ items?: YoutubeChannel[] }>(admin, userId, "/channels?part=snippet,contentDetails&mine=true&maxResults=1");
  const channel = channelResponse.items?.[0];
  if (!channel?.id) throw new Error("No encontramos un canal de YouTube conectado.");
  const uploadsPlaylist = channel.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylist) throw new Error("YouTube no devolvió la lista de videos del canal.");
  const playerId = await editablePlayerId(admin, userId);
  if (!playerId) throw new Error("No pudimos resolver tu Player para sincronizar YouTube.");

  const playlist = await youtubeUserApi<{ items?: YoutubePlaylistItem[] }>(admin, userId, `/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(uploadsPlaylist)}&maxResults=12`);
  const normalized = (playlist.items || []).map((item, index) => {
    const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || "";
    const thumbs = item.snippet?.thumbnails || {};
    return {
      videoId,
      title: item.snippet?.title || "Video de YouTube",
      thumbnailUrl: thumbs.maxres?.url || thumbs.standard?.url || thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || null,
      publishedAt: item.snippet?.publishedAt || null,
      displayOrder: index,
    };
  }).filter((item) => item.videoId && item.title !== "Private video" && item.title !== "Deleted video");

  const externalIds = normalized.map((item) => item.videoId);
  const existingResult = externalIds.length
    ? await admin.from("player_media").select("id,external_id").eq("player_id", playerId).eq("origin", "youtube").in("external_id", externalIds)
    : { data: [], error: null };
  if (existingResult.error) throw new Error(existingResult.error.message);
  const existing = new Map((existingResult.data || []).map((row) => [String(row.external_id), String(row.id)]));
  const now = new Date().toISOString();

  for (const item of normalized) {
    const payload = {
      player_id: playerId,
      studio_id: null,
      media_type: "video",
      origin: "youtube",
      external_id: item.videoId,
      source_url: `https://www.youtube.com/watch?v=${item.videoId}`,
      public_url: null,
      thumbnail_url: item.thumbnailUrl,
      caption: item.title,
      alt_text: item.title,
      display_order: item.displayOrder,
      visibility: "public",
      imported_at: item.publishedAt || now,
      updated_at: now,
    };
    const id = existing.get(item.videoId);
    const result = id
      ? await admin.from("player_media").update(payload).eq("id", id)
      : await admin.from("player_media").insert(payload);
    if (result.error) throw new Error(`No se pudo sincronizar el video ${item.videoId}: ${result.error.message}`);
  }

  const url = channelUrl(channel);
  const connection = await loadYoutubeConnection(admin, userId);
  if (connection) {
    const { error } = await admin.from("social_connections").update({
      external_username: channelHandle(channel),
      display_name: channel.snippet?.title || connection.display_name,
      metadata: { ...(connection.metadata || {}), channel_url: url, thumbnail_url: thumbnail(channel), uploads_playlist_id: uploadsPlaylist },
      last_synced_at: now,
      updated_at: now,
    }).eq("id", connection.id);
    if (error) throw new Error(error.message);
  }
  const { error: playerError } = await admin.from("players").update({ youtube_channel_url: url }).eq("id", playerId);
  if (playerError) throw new Error(playerError.message);

  return { synced: normalized.length, channelUrl: url, videos: normalized.map((item) => ({ id: item.videoId, title: item.title, thumbnailUrl: item.thumbnailUrl })) };
}

export async function getYoutubePublicConnection(admin: SupabaseClient, userId: string): Promise<YoutubePublicConnection> {
  const row = await loadYoutubeConnection(admin, userId);
  if (!row) return { connected: false, provider: "youtube", displayName: null, externalUsername: null, channelUrl: null, thumbnailUrl: null, status: null, connectedAt: null, lastSyncedAt: null };
  return {
    connected: row.status === "active",
    provider: "youtube",
    displayName: row.display_name,
    externalUsername: row.external_username,
    channelUrl: typeof row.metadata?.channel_url === "string" ? row.metadata.channel_url : null,
    thumbnailUrl: typeof row.metadata?.thumbnail_url === "string" ? row.metadata.thumbnail_url : null,
    status: row.status,
    connectedAt: row.connected_at,
    lastSyncedAt: row.last_synced_at,
  };
}

export async function disconnectYoutube(admin: SupabaseClient, userId: string) {
  const { error } = await admin.from("social_connections").update({
    status: "disconnected",
    access_token_ciphertext: null,
    token_iv: null,
    token_auth_tag: null,
    refresh_token_ciphertext: null,
    refresh_token_iv: null,
    refresh_token_auth_tag: null,
    expires_at: null,
    updated_at: new Date().toISOString(),
  }).eq("provider", "youtube").eq("user_id", userId);
  if (error) throw new Error(`No se pudo desconectar YouTube: ${error.message}`);
}
