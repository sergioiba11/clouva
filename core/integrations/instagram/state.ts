import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256 } from "./crypto";

const STATE_TTL_MINUTES = 10;

export type CreatedInstagramState = {
  rawState: string;
  rawContinuation?: string;
  expiresAt: string;
};

export async function createInstagramState(options: {
  admin: SupabaseClient;
  userId?: string;
  studioId?: string;
  returnPath?: string;
  useContinuation?: boolean;
}): Promise<CreatedInstagramState> {
  const rawState = randomBytes(32).toString("base64url");
  const rawContinuation = options.useContinuation
    ? randomBytes(32).toString("base64url")
    : undefined;
  const expiresAt = new Date(Date.now() + STATE_TTL_MINUTES * 60_000).toISOString();

  const { error } = await options.admin.from("social_oauth_states").insert({
    provider: "instagram",
    state_hash: sha256(rawState),
    user_id: options.userId ?? null,
    studio_id: options.studioId ?? null,
    continuation_hash: rawContinuation ? sha256(rawContinuation) : null,
    return_path: options.returnPath || "/onboarding/instagram/select",
    status: "pending",
    expires_at: expiresAt,
  });
  if (error) throw new Error(`No se pudo iniciar la conexión con Instagram: ${error.message}`);

  return { rawState, rawContinuation, expiresAt };
}

export async function consumeInstagramState(admin: SupabaseClient, rawState: string) {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("social_oauth_states")
    .update({ status: "consumed", consumed_at: now })
    .eq("provider", "instagram")
    .eq("state_hash", sha256(rawState))
    .eq("status", "pending")
    .gt("expires_at", now)
    .select("id,user_id,studio_id,continuation_hash,return_path,expires_at,metadata")
    .maybeSingle();

  if (error) throw new Error(`No se pudo validar el estado OAuth: ${error.message}`);
  if (!data) throw new Error("La conexión con Instagram venció o ya fue utilizada.");
  return data as {
    id: string;
    user_id: string | null;
    studio_id: string | null;
    continuation_hash: string | null;
    return_path: string;
    expires_at: string;
    metadata: Record<string, unknown>;
  };
}
