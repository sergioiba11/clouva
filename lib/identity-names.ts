import type { User } from "@supabase/supabase-js";
import type { Player } from "@/lib/players-data";

type ProfileIdentity = {
  display_name?: string | null;
  username?: string | null;
  full_name?: string | null;
};

type PlayerIdentity = Pick<Player, "display_name" | "is_published" | "publication_status">;

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolveOAuthName(user: User | null | undefined) {
  if (!user) return null;
  return (
    clean(user.user_metadata?.full_name) ??
    clean(user.user_metadata?.name) ??
    clean(user.user_metadata?.display_name)
  );
}

export function resolveEmailUsername(user: User | null | undefined) {
  const email = clean(user?.email);
  return email ? clean(email.split("@")[0]) : null;
}

export function resolveHomeDisplayName({
  currentPlayer,
  profile,
  user,
}: {
  currentPlayer?: PlayerIdentity | null;
  profile?: ProfileIdentity | null;
  user?: User | null;
}) {
  return (
    clean(currentPlayer?.display_name) ??
    clean(profile?.display_name) ??
    clean(profile?.username)?.replace(/^@/, "") ??
    clean(profile?.full_name) ??
    resolveOAuthName(user) ??
    resolveEmailUsername(user) ??
    "CLOUVA"
  );
}

export function resolveAccountDisplayName({
  profile,
  user,
}: {
  profile?: ProfileIdentity | null;
  user?: User | null;
}) {
  return (
    clean(profile?.display_name) ??
    clean(profile?.username)?.replace(/^@/, "") ??
    clean(profile?.full_name) ??
    resolveOAuthName(user) ??
    resolveEmailUsername(user) ??
    "CLOUVA"
  );
}

export type CurrentPlayerStatus = "none" | "draft" | "published";

export function resolveCurrentPlayerStatus(currentPlayer: PlayerIdentity | null | undefined): CurrentPlayerStatus {
  if (!currentPlayer) return "none";
  return currentPlayer.is_published && currentPlayer.publication_status === "published" ? "published" : "draft";
}
