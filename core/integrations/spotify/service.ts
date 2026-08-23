import type { SupabaseClient } from "@supabase/supabase-js";
import { getSpotifyConfig, isSpotifyEnabled } from "./config";
import { decryptSpotifySecret, encryptSpotifySecret } from "./crypto";
import { refreshSpotifyToken, SpotifyApiError, spotifyApiFetch } from "./client";
import type { SpotifyMe, SpotifyPublicConnection, SpotifyTokenResponse } from "./types";

type ConnectionRow = {
  id: string;
  user_id: string | null;
  external_account_id: string;
  external_username: string | null;
  display_name: string | null;
  account_type: string | null;
  access_token_ciphertext: string | null;
  token_iv: string | null;
  token_auth_tag: string | null;
  token_key_version: string | null;
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

export class SpotifyConnectionError extends Error {
  constructor(public readonly code: "spotify_connection_required" | "spotify_reconnect_required") {
    super(code);
    this.name = "SpotifyConnectionError";
  }
}

const connectionSelect = [
  "id,user_id,external_account_id,external_username,display_name,account_type",
  "access_token_ciphertext,token_iv,token_auth_tag,token_key_version",
  "refresh_token_ciphertext,refresh_token_iv,refresh_token_auth_tag",
  "expires_at,scopes,status,metadata,connected_at,last_synced_at",
].join(",");

export async function loadSpotifyConnection(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin
    .from("social_connections")
    .select(connectionSelect)
    .eq("provider", "spotify")
    .eq("user_id", userId)
    .in("status", ["active", "expired"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer Spotify: ${error.message}`);
  return data as ConnectionRow | null;
}

function decryptAccess(row: ConnectionRow) {
  if (!row.access_token_ciphertext || !row.token_iv || !row.token_auth_tag) {
    throw new SpotifyConnectionError("spotify_reconnect_required");
  }
  return decryptSpotifySecret({
    ciphertext: row.access_token_ciphertext,
    iv: row.token_iv,
    authTag: row.token_auth_tag,
  });
}

function decryptRefresh(row: ConnectionRow) {
  if (!row.refresh_token_ciphertext || !row.refresh_token_iv || !row.refresh_token_auth_tag) {
    throw new SpotifyConnectionError("spotify_reconnect_required");
  }
  return decryptSpotifySecret({
    ciphertext: row.refresh_token_ciphertext,
    iv: row.refresh_token_iv,
    authTag: row.refresh_token_auth_tag,
  });
}

export async function persistSpotifyConnection(options: {
  admin: SupabaseClient;
  userId: string;
  tokens: SpotifyTokenResponse;
  me: SpotifyMe;
}) {
  const { admin, userId, tokens, me } = options;
  const { data: existing, error: existingError } = await admin
    .from("social_connections")
    .select("id,user_id,status")
    .eq("provider", "spotify")
    .eq("external_account_id", me.id)
    .maybeSingle();
  if (existingError) throw new Error(`No se pudo validar la cuenta Spotify: ${existingError.message}`);
  if (existing?.user_id && existing.user_id !== userId && existing.status === "active") {
    throw new Error("Esta cuenta de Spotify ya está conectada a otro usuario CLOUVA.");
  }

  const config = getSpotifyConfig();
  const access = encryptSpotifySecret(tokens.access_token);
  const refresh = tokens.refresh_token ? encryptSpotifySecret(tokens.refresh_token) : null;
  const scopes = (tokens.scope || config.scopes.join(" ")).split(/\s+/).filter(Boolean);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.max(1, tokens.expires_in) * 1000).toISOString();
  const imageUrl = me.images?.[0]?.url || null;
  const row = {
    user_id: userId,
    studio_id: null,
    provider: "spotify",
    external_account_id: me.id,
    external_username: null,
    display_name: me.display_name || me.id,
    account_type: "listener",
    access_token_ciphertext: access.ciphertext,
    token_iv: access.iv,
    token_auth_tag: access.authTag,
    token_key_version: config.tokenKeyVersion,
    ...(refresh ? {
      refresh_token_ciphertext: refresh.ciphertext,
      refresh_token_iv: refresh.iv,
      refresh_token_auth_tag: refresh.authTag,
    } : {}),
    expires_at: expiresAt,
    scopes,
    status: "active",
    metadata: { avatar_url: imageUrl, spotify_url: me.external_urls?.spotify || null },
    connected_at: now,
    last_synced_at: now,
    updated_at: now,
  };

  if (existing?.id) {
    const { data, error } = await admin.from("social_connections").update(row).eq("id", existing.id).select("id").single();
    if (error) throw new Error(`No se pudo guardar Spotify: ${error.message}`);
    return String(data.id);
  }
  const { data, error } = await admin.from("social_connections").insert(row).select("id").single();
  if (error) throw new Error(`No se pudo guardar Spotify: ${error.message}`);
  return String(data.id);
}

async function refreshConnection(admin: SupabaseClient, row: ConnectionRow) {
  const refreshToken = decryptRefresh(row);
  const tokens = await refreshSpotifyToken(refreshToken);
  const access = encryptSpotifySecret(tokens.access_token);
  const refresh = tokens.refresh_token ? encryptSpotifySecret(tokens.refresh_token) : null;
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
  if (refresh) {
    patch.refresh_token_ciphertext = refresh.ciphertext;
    patch.refresh_token_iv = refresh.iv;
    patch.refresh_token_auth_tag = refresh.authTag;
  }
  const { error } = await admin.from("social_connections").update(patch).eq("id", row.id);
  if (error) throw new Error(`No se pudo refrescar Spotify: ${error.message}`);
  return tokens.access_token;
}

export async function getSpotifyUserAccessToken(admin: SupabaseClient, userId: string) {
  if (!isSpotifyEnabled()) throw new Error("spotify_disabled");
  const row = await loadSpotifyConnection(admin, userId);
  if (!row) throw new SpotifyConnectionError("spotify_connection_required");
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (!expiresAt || expiresAt <= Date.now() + 60_000 || row.status === "expired") {
    try {
      return await refreshConnection(admin, row);
    } catch (error) {
      await admin.from("social_connections").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", row.id);
      if (error instanceof SpotifyConnectionError) throw error;
      throw new SpotifyConnectionError("spotify_reconnect_required");
    }
  }
  return decryptAccess(row);
}

export async function spotifyUserApi<T>(admin: SupabaseClient, userId: string, path: string, method: "GET" | "POST" | "PUT" | "DELETE" = "GET", body?: unknown) {
  const token = await getSpotifyUserAccessToken(admin, userId);
  try {
    return await spotifyApiFetch<T>({ accessToken: token, path, method, body });
  } catch (error) {
    if (error instanceof SpotifyApiError && error.status === 401) {
      const row = await loadSpotifyConnection(admin, userId);
      if (!row) throw new SpotifyConnectionError("spotify_connection_required");
      const refreshed = await refreshConnection(admin, row).catch(() => null);
      if (!refreshed) throw new SpotifyConnectionError("spotify_reconnect_required");
      return spotifyApiFetch<T>({ accessToken: refreshed, path, method, body, retry429: false });
    }
    throw error;
  }
}

export async function saveSpotifyUri(admin: SupabaseClient, userId: string, uri: string) {
  await spotifyUserApi<void>(admin, userId, `/me/library?uris=${encodeURIComponent(uri)}`, "PUT");
}

export async function removeSpotifyUri(admin: SupabaseClient, userId: string, uri: string) {
  await spotifyUserApi<void>(admin, userId, `/me/library?uris=${encodeURIComponent(uri)}`, "DELETE");
}

export async function isSpotifyUriSaved(admin: SupabaseClient, userId: string, uri: string) {
  const result = await spotifyUserApi<boolean[]>(admin, userId, `/me/library/contains?uris=${encodeURIComponent(uri)}`);
  return result[0] === true;
}

export async function getSpotifyPublicConnection(admin: SupabaseClient, userId: string): Promise<SpotifyPublicConnection> {
  const row = await loadSpotifyConnection(admin, userId);
  if (!row) {
    return { connected: false, provider: "spotify", displayName: null, externalUsername: null, avatarUrl: null, scopes: [], status: null, connectedAt: null, lastSyncedAt: null };
  }
  return {
    connected: row.status === "active",
    provider: "spotify",
    displayName: row.display_name,
    externalUsername: row.external_username,
    avatarUrl: typeof row.metadata?.avatar_url === "string" ? row.metadata.avatar_url : null,
    scopes: row.scopes || [],
    status: row.status,
    connectedAt: row.connected_at,
    lastSyncedAt: row.last_synced_at,
  };
}

export async function disconnectSpotify(admin: SupabaseClient, userId: string) {
  const { error } = await admin
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
      updated_at: new Date().toISOString(),
    })
    .eq("provider", "spotify")
    .eq("user_id", userId);
  if (error) throw new Error(`No se pudo desconectar Spotify: ${error.message}`);
}
