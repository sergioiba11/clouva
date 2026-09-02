import type { SupabaseClient } from "@supabase/supabase-js";
import { youtubeApiFetch } from "./client";
import type { YoutubeChannel, YoutubePlaylistItem } from "./types";

type ConnectionIdentityRow = {
  id: string;
  user_id: string | null;
  external_account_id: string;
  status: string;
  connected_at: string | null;
  last_synced_at: string | null;
  metadata: Record<string, unknown> | null;
};

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

async function fetchChannel(accessToken: string) {
  const response = await youtubeApiFetch<{ items?: YoutubeChannel[] }>({
    accessToken,
    path: "/channels?part=snippet,contentDetails&mine=true&maxResults=1",
  });
  const channel = response.items?.[0];
  if (!channel?.id) throw new Error("Google no devolvió un canal de YouTube para esta cuenta.");
  return channel;
}

async function persistConnection(options: {
  admin: SupabaseClient;
  userId: string;
  channel: YoutubeChannel;
  scope?: string;
}) {
  const { admin, userId, channel, scope } = options;
  const { data: existingData, error: existingError } = await admin
    .from("social_connections")
    .select("id,user_id,external_account_id,status,connected_at,last_synced_at,metadata")
    .eq("provider", "youtube")
    .eq("external_account_id", channel.id)
    .maybeSingle();
  if (existingError) throw new Error(`No se pudo validar la cuenta YouTube: ${existingError.message}`);

  const existing = existingData as ConnectionIdentityRow | null;
  if (existing?.user_id && existing.user_id !== userId && existing.status === "active") {
    throw new Error("Este canal de YouTube ya está conectado a otro usuario CLOUVA.");
  }

  const now = new Date().toISOString();
  const clearOther = await admin
    .from("social_connections")
    .update({
      status: "disconnected",
      access_token_ciphertext: null,
      token_iv: null,
      token_auth_tag: null,
      refresh_token_ciphertext: null,
      refresh_token_iv: null,
      refresh_token_auth_tag: null,
      expires_at: null,
      updated_at: now,
    })
    .eq("provider", "youtube")
    .eq("user_id", userId)
    .neq("external_account_id", channel.id)
    .in("status", ["active", "expired"]);
  if (clearOther.error) throw new Error(`No se pudo actualizar la conexión anterior de YouTube: ${clearOther.error.message}`);

  const metadata = {
    ...(existing?.metadata || {}),
    channel_url: channelUrl(channel),
    thumbnail_url: thumbnail(channel),
    uploads_playlist_id: channel.contentDetails?.relatedPlaylists?.uploads || null,
    authorization_mode: "google_identity_services_token",
    token_persisted: false,
  };

  const row: Record<string, unknown> = {
    user_id: userId,
    studio_id: null,
    provider: "youtube",
    external_account_id: channel.id,
    external_username: channelHandle(channel),
    display_name: channel.snippet?.title || channel.id,
    account_type: "channel",
    access_token_ciphertext: null,
    token_iv: null,
    token_auth_tag: null,
    token_key_version: null,
    refresh_token_ciphertext: null,
    refresh_token_iv: null,
    refresh_token_auth_tag: null,
    expires_at: null,
    scopes: (scope || "https://www.googleapis.com/auth/youtube.readonly").split(/\s+/).filter(Boolean),
    status: "active",
    metadata,
    connected_at: existing?.connected_at || now,
    last_synced_at: existing?.last_synced_at || null,
    updated_at: now,
  };

  if (existing?.id) {
    const { error } = await admin.from("social_connections").update(row).eq("id", existing.id);
    if (error) throw new Error(`No se pudo guardar YouTube: ${error.message}`);
    return existing.id;
  }

  const { data, error } = await admin.from("social_connections").insert(row).select("id").single();
  if (error) throw new Error(`No se pudo guardar YouTube: ${error.message}`);
  return String(data.id);
}

async function activeConnection(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin
    .from("social_connections")
    .select("id,user_id,external_account_id,status,connected_at,last_synced_at,metadata")
    .eq("provider", "youtube")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer YouTube: ${error.message}`);
  return data as ConnectionIdentityRow | null;
}

async function syncChannel(options: {
  admin: SupabaseClient;
  userId: string;
  accessToken: string;
  channel: YoutubeChannel;
}) {
  const { admin, userId, accessToken, channel } = options;
  const uploadsPlaylist = channel.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylist) throw new Error("YouTube no devolvió la lista de videos del canal.");

  const playerId = await editablePlayerId(admin, userId);
  if (!playerId) throw new Error("No pudimos resolver tu Player para sincronizar YouTube.");

  const playlist = await youtubeApiFetch<{ items?: YoutubePlaylistItem[] }>({
    accessToken,
    path: `/playlistItems?part=snippet,contentDetails&playlistId=${encodeURIComponent(uploadsPlaylist)}&maxResults=12`,
  });
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
  const connection = await activeConnection(admin, userId);
  if (!connection || connection.external_account_id !== channel.id) {
    throw new Error("La cuenta de Google seleccionada no corresponde al canal de YouTube conectado.");
  }

  const { error: connectionError } = await admin.from("social_connections").update({
    external_username: channelHandle(channel),
    display_name: channel.snippet?.title || channel.id,
    status: "active",
    metadata: {
      ...(connection.metadata || {}),
      channel_url: url,
      thumbnail_url: thumbnail(channel),
      uploads_playlist_id: uploadsPlaylist,
      authorization_mode: "google_identity_services_token",
      token_persisted: false,
    },
    last_synced_at: now,
    updated_at: now,
  }).eq("id", connection.id);
  if (connectionError) throw new Error(connectionError.message);

  const { error: playerError } = await admin.from("players").update({
    youtube_channel_id: channel.id,
    youtube_channel_url: url,
    youtube_last_sync_at: now,
    youtube_sync_status: "synced",
    youtube_sync_error: null,
    updated_at: now,
  }).eq("id", playerId);
  if (playerError) throw new Error(playerError.message);

  return {
    synced: normalized.length,
    channelUrl: url,
    channelId: channel.id,
    displayName: channel.snippet?.title || channel.id,
    videos: normalized.map((item) => ({ id: item.videoId, title: item.title, thumbnailUrl: item.thumbnailUrl })),
  };
}

export async function connectYoutubeWithBrowserToken(options: {
  admin: SupabaseClient;
  userId: string;
  accessToken: string;
  scope?: string;
}) {
  const channel = await fetchChannel(options.accessToken);
  await persistConnection({ admin: options.admin, userId: options.userId, channel, scope: options.scope });
  return syncChannel({ admin: options.admin, userId: options.userId, accessToken: options.accessToken, channel });
}

export async function syncYoutubeWithBrowserToken(options: {
  admin: SupabaseClient;
  userId: string;
  accessToken: string;
}) {
  const connection = await activeConnection(options.admin, options.userId);
  if (!connection) throw new Error("youtube_connection_required");

  const channel = await fetchChannel(options.accessToken);
  if (connection.external_account_id !== channel.id) {
    throw new Error("La cuenta de Google seleccionada no corresponde al canal de YouTube conectado.");
  }

  return syncChannel({ admin: options.admin, userId: options.userId, accessToken: options.accessToken, channel });
}
