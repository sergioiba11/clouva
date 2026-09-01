import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { youtubeSha256 } from "./crypto";

const STATE_TTL_MINUTES = 10;
const DEFAULT_RETURN_PATH = "/profile/edit?section=youtube";

export function sanitizeYoutubeReturnPath(value: unknown) {
  if (typeof value !== "string") return DEFAULT_RETURN_PATH;
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return DEFAULT_RETURN_PATH;
  return candidate.slice(0, 600);
}

export async function createYoutubeState(options: { admin: SupabaseClient; userId: string; returnPath?: unknown }) {
  const rawState = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + STATE_TTL_MINUTES * 60_000).toISOString();
  const returnPath = sanitizeYoutubeReturnPath(options.returnPath);
  const { error } = await options.admin.from("social_oauth_states").insert({
    provider: "youtube",
    state_hash: youtubeSha256(rawState),
    user_id: options.userId,
    studio_id: null,
    return_path: returnPath,
    status: "pending",
    expires_at: expiresAt,
    metadata: {},
  });
  if (error) throw new Error(`No se pudo iniciar YouTube: ${error.message}`);
  return { rawState, returnPath, expiresAt };
}

export async function consumeYoutubeState(admin: SupabaseClient, rawState: string) {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("social_oauth_states")
    .update({ status: "consumed", consumed_at: now })
    .eq("provider", "youtube")
    .eq("state_hash", youtubeSha256(rawState))
    .eq("status", "pending")
    .gt("expires_at", now)
    .select("id,user_id,return_path")
    .maybeSingle();
  if (error) throw new Error(`No se pudo validar YouTube OAuth: ${error.message}`);
  if (!data?.user_id) throw new Error("La conexión con YouTube venció o ya fue utilizada.");
  return { id: String(data.id), userId: String(data.user_id), returnPath: sanitizeYoutubeReturnPath(data.return_path) };
}
