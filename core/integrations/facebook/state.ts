import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { facebookSha256 } from "./crypto";

const STATE_TTL_MINUTES = 10;

export async function createFacebookState(options: {
  admin: SupabaseClient;
  userId: string;
  spaceId: string;
}) {
  const rawState = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + STATE_TTL_MINUTES * 60_000).toISOString();
  const { error } = await options.admin.from("social_oauth_states").insert({
    provider: "facebook",
    state_hash: facebookSha256(rawState),
    user_id: options.userId,
    studio_id: null,
    return_path: `/businesses/${options.spaceId}/publicador`,
    status: "pending",
    expires_at: expiresAt,
    metadata: { space_id: options.spaceId },
  });
  if (error) throw new Error(`No se pudo iniciar Facebook: ${error.message}`);
  return { rawState, expiresAt };
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
    .select("id,user_id,return_path,metadata")
    .maybeSingle();
  if (error) throw new Error(`No se pudo validar Facebook OAuth: ${error.message}`);
  if (!data?.user_id) throw new Error("La conexión con Facebook venció o ya fue utilizada.");
  const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata as Record<string, unknown> : {};
  const spaceId = typeof metadata.space_id === "string" ? metadata.space_id : "";
  if (!spaceId) throw new Error("El estado OAuth de Facebook no contiene el Bisnes destino.");
  return { userId: String(data.user_id), spaceId, returnPath: `/businesses/${spaceId}/publicador` };
}
