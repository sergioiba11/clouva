import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { facebookSha256 } from "./crypto";

const STATE_TTL_MINUTES = 10;

export function sanitizeFacebookReturnPath(value: unknown) {
  if (typeof value !== "string") return "/mi-spot/publicador";
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return "/mi-spot/publicador";
  }
  return candidate.slice(0, 800);
}

export async function createFacebookState(options: {
  admin: SupabaseClient;
  userId: string;
  returnPath: unknown;
}) {
  const rawState = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + STATE_TTL_MINUTES * 60_000).toISOString();
  const returnPath = sanitizeFacebookReturnPath(options.returnPath);
  const { error } = await options.admin.from("social_oauth_states").insert({
    provider: "facebook",
    state_hash: facebookSha256(rawState),
    user_id: options.userId,
    studio_id: null,
    return_path: returnPath,
    status: "pending",
    expires_at: expiresAt,
    metadata: {},
  });
  if (error) throw new Error("No se pudo iniciar Facebook: " + error.message);
  return { rawState, returnPath, expiresAt };
}

export async function consumeFacebookState(admin: SupabaseClient, rawState: string) {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("social_oauth_states")
    .update({ status: "consumed", consumed_at: now })
    .eq("provider", "facebook")
    .eq("state_hash", facebookSha256(rawState))
    .eq("status", "pending")
    .gt("expires_at", now)
    .select("id,user_id,return_path")
    .maybeSingle();
  if (error) throw new Error("No se pudo validar Facebook OAuth: " + error.message);
  if (!data?.user_id) throw new Error("La conexión con Facebook venció o ya fue utilizada.");
  return {
    id: String(data.id),
    userId: String(data.user_id),
    returnPath: sanitizeFacebookReturnPath(data.return_path),
  };
}
