import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { spotifySha256 } from "./crypto";
import type { SpotifyPendingAction } from "./types";

const STATE_TTL_MINUTES = 10;

export function sanitizeSpotifyReturnPath(value: unknown) {
  if (typeof value !== "string") return "/settings/connections";
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return "/settings/connections";
  }
  return candidate.slice(0, 600);
}

export function parseSpotifyPendingAction(value: unknown): SpotifyPendingAction | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (source.type !== "save_track" && source.type !== "follow_artist") return null;
  if (typeof source.uri !== "string") return null;
  const uri = source.uri.trim();
  if (source.type === "save_track" && !/^spotify:track:[A-Za-z0-9]+$/.test(uri)) return null;
  if (source.type === "follow_artist" && !/^spotify:artist:[A-Za-z0-9]+$/.test(uri)) return null;
  return { type: source.type, uri } as SpotifyPendingAction;
}

export async function createSpotifyState(options: {
  admin: SupabaseClient;
  userId: string;
  returnPath?: unknown;
  pendingAction?: unknown;
}) {
  const rawState = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + STATE_TTL_MINUTES * 60_000).toISOString();
  const returnPath = sanitizeSpotifyReturnPath(options.returnPath);
  const pendingAction = parseSpotifyPendingAction(options.pendingAction);
  const { error } = await options.admin.from("social_oauth_states").insert({
    provider: "spotify",
    state_hash: spotifySha256(rawState),
    user_id: options.userId,
    studio_id: null,
    return_path: returnPath,
    status: "pending",
    expires_at: expiresAt,
    metadata: pendingAction ? { pendingAction } : {},
  });
  if (error) throw new Error(`No se pudo iniciar Spotify: ${error.message}`);
  return { rawState, expiresAt, returnPath };
}

export async function consumeSpotifyState(admin: SupabaseClient, rawState: string) {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("social_oauth_states")
    .update({ status: "consumed", consumed_at: now })
    .eq("provider", "spotify")
    .eq("state_hash", spotifySha256(rawState))
    .eq("status", "pending")
    .gt("expires_at", now)
    .select("id,user_id,return_path,metadata")
    .maybeSingle();
  if (error) throw new Error(`No se pudo validar Spotify OAuth: ${error.message}`);
  if (!data?.user_id) throw new Error("La conexión con Spotify venció o ya fue utilizada.");
  return {
    id: String(data.id),
    userId: String(data.user_id),
    returnPath: sanitizeSpotifyReturnPath(data.return_path),
    pendingAction: parseSpotifyPendingAction((data.metadata as Record<string, unknown> | null)?.pendingAction),
  };
}
