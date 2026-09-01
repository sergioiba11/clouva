import "server-only";

import { isReservedPublicAlias } from "@/lib/navigation/reserved-public-aliases";
import { createAdminSupabase } from "@/lib/server/supabase";

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$/;

export type PlayerBasics = {
  id: string;
  display_name: string | null;
  username: string | null;
  owner_user_id: string | null;
};

type AdminClient = ReturnType<typeof createAdminSupabase>;

type TypedError = Error & { status?: number; code?: string };

function typedError(message: string, status: number, code: string): TypedError {
  const error = new Error(message) as TypedError;
  error.status = status;
  error.code = code;
  return error;
}

export function normalizePlayerUsername(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/^@+/, "");
}

export function validatePlayerUsername(value: unknown) {
  const username = normalizePlayerUsername(value);
  if (!USERNAME_RE.test(username)) {
    throw typedError(
      "El @ debe tener entre 3 y 30 caracteres y usar sólo letras minúsculas, números, punto, guion o guion bajo.",
      400,
      "INVALID_USERNAME",
    );
  }
  if (isReservedPublicAlias(username)) {
    throw typedError("Ese @ está reservado por CLOUVA.", 409, "RESERVED_USERNAME");
  }
  return username;
}

export function normalizePlayerDisplayName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 160) : "";
}

export function playerBasicsComplete(player: PlayerBasics | null | undefined) {
  return Boolean(
    player
      && normalizePlayerDisplayName(player.display_name)
      && normalizePlayerUsername(player.username)
      && USERNAME_RE.test(normalizePlayerUsername(player.username)),
  );
}

export async function getOwnedPlayerBasics(admin: AdminClient, userId: string): Promise<PlayerBasics | null> {
  const { data, error } = await admin
    .from("players")
    .select("id,display_name,username,owner_user_id")
    .eq("owner_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as PlayerBasics | null;
}

export async function assertPlayerUsernameAvailable(
  admin: AdminClient,
  username: string,
  currentPlayerId?: string,
) {
  const [playerResult, aliasResult] = await Promise.all([
    admin.from("players").select("id,username").ilike("username", username).limit(2),
    admin.from("public_slug_aliases").select("entity_id,entity_type").eq("normalized_alias", username).limit(2),
  ]);
  if (playerResult.error) throw new Error(playerResult.error.message);
  if (aliasResult.error) throw new Error(aliasResult.error.message);

  const playerTaken = (playerResult.data ?? []).some((row) => String(row.id) !== String(currentPlayerId ?? ""));
  const aliasTaken = (aliasResult.data ?? []).some((row) => String(row.entity_id) !== String(currentPlayerId ?? ""));
  if (playerTaken || aliasTaken) {
    throw typedError("Ese @ ya está en uso.", 409, "USERNAME_TAKEN");
  }
}

export async function requirePlayerBasics(admin: AdminClient, userId: string) {
  const player = await getOwnedPlayerBasics(admin, userId);
  if (!player || !playerBasicsComplete(player)) {
    throw typedError("Completá tu nombre y @ antes de continuar.", 428, "PLAYER_BASICS_REQUIRED");
  }
  return player;
}
