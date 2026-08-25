// Context Resolver — builds the *compact* context a Studio-scoped CLOUVA AI
// conversation gets, instead of the Orchestrator dumping full tables into
// the prompt. Two-step plain queries (not PostgREST embeds) so the FK/join
// shape doesn't have to be guessed — the tables involved (studios,
// studio_members, players, player_studios, player_profile_versions) are
// real domain tables, never reshaped or duplicated here.
//
// Deliberately NOT resolved here (left as an explicit boundary, not guessed
// at): a linked Workspace project (local code on the user's PC) — that
//   mapping lives in Workspace's own local project registry
//   (ProjectDescriptor.studioId, per the approved architecture), not in
//   Supabase, and resolving it needs the WorkspaceExecutor (Task 10) to
//   actually ask Desktop. A domain tool surfaces it on demand instead of
//   this resolver guessing.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface StudioContext {
  studio: { id: string; name: string; slug: string; tagline: string | null; description: string | null } | null;
  summary: string;
}

interface MemberRow {
  role: string;
  displayName: string;
}

interface PlayerRow {
  id: string;
  displayName: string;
  role: string | null;
  secondaryRole: string | null;
  customTitle: string | null;
  latestProfileVersion: { versionNumber: number; status: string; profileLevel: string } | null;
}

const MAX_MEMBERS = 20;
const MAX_PLAYERS = 30;

export async function resolveStudioContext(supabase: SupabaseClient, studioId: string): Promise<StudioContext> {
  const { data: studio } = await supabase
    .from("studios")
    .select("id,name,slug,tagline,description")
    .eq("id", studioId)
    .maybeSingle();

  if (!studio) {
    return { studio: null, summary: "El Estudio referenciado ya no existe o no es accesible." };
  }

  const [{ data: memberRows }, { data: playerLinkRows }] = await Promise.all([
    supabase.from("studio_members").select("profile_id,role").eq("studio_id", studioId).eq("status", "active").limit(MAX_MEMBERS),
    supabase
      .from("player_studios")
      .select("player_id,role,secondary_role,custom_title")
      .eq("studio_id", studioId)
      .eq("status", "active")
      .limit(MAX_PLAYERS),
  ]);

  const profileIds = (memberRows ?? []).map((m) => m.profile_id);
  const playerIds = (playerLinkRows ?? []).map((p) => p.player_id);

  const [{ data: profileRows }, { data: playerRows }, { data: profileVersionRows }] = await Promise.all([
    profileIds.length
      ? supabase.from("profiles").select("id,display_name,username").in("id", profileIds)
      : Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null; username: string | null }> }),
    playerIds.length
      ? supabase.from("players").select("id,display_name").in("id", playerIds)
      : Promise.resolve({ data: [] as Array<{ id: string; display_name: string }> }),
    playerIds.length
      ? supabase
          .from("player_profile_versions")
          .select("player_id,version_number,status,profile_level,created_at")
          .in("player_id", playerIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Array<{ player_id: string; version_number: number; status: string; profile_level: string }> }),
  ]);

  const profileNameById = new Map((profileRows ?? []).map((p) => [p.id, p.display_name || p.username || "sin nombre"]));
  const playerNameById = new Map((playerRows ?? []).map((p) => [p.id, p.display_name]));

  // Rows came back newest-first — the first one seen per player_id is its
  // most recent profile version. Keep only that one, not the whole history.
  const latestVersionByPlayer = new Map<string, { versionNumber: number; status: string; profileLevel: string }>();
  for (const row of profileVersionRows ?? []) {
    if (latestVersionByPlayer.has(row.player_id)) continue;
    latestVersionByPlayer.set(row.player_id, { versionNumber: row.version_number, status: row.status, profileLevel: row.profile_level });
  }

  const members: MemberRow[] = (memberRows ?? []).map((m) => ({
    role: m.role,
    displayName: profileNameById.get(m.profile_id) ?? "sin nombre",
  }));

  const players: PlayerRow[] = (playerLinkRows ?? []).map((link) => ({
    id: link.player_id,
    displayName: playerNameById.get(link.player_id) ?? "sin nombre",
    role: link.role,
    secondaryRole: link.secondary_role,
    customTitle: link.custom_title,
    latestProfileVersion: latestVersionByPlayer.get(link.player_id) ?? null,
  }));

  const summary = summarize(studio, members, players);
  return { studio, summary };
}

function summarize(
  studio: { name: string; slug: string; tagline: string | null; description: string | null },
  members: MemberRow[],
  players: PlayerRow[],
): string {
  const parts: string[] = [];
  parts.push(`Estudio activo: "${studio.name}" (slug: ${studio.slug}).`);
  if (studio.tagline) parts.push(`Tagline: ${studio.tagline}`);
  if (studio.description) parts.push(`Descripción: ${studio.description}`);

  parts.push(
    members.length
      ? `Miembros internos activos (${members.length}): ${members.map((m) => `${m.displayName} (${m.role})`).join(", ")}.`
      : "Sin miembros internos activos registrados.",
  );

  if (players.length) {
    const lines = players.map((p) => {
      const roles = [p.role, p.secondaryRole].filter(Boolean).join(" / ");
      const title = p.customTitle ? ` "${p.customTitle}"` : "";
      const version = p.latestProfileVersion
        ? ` — perfil visual: v${p.latestProfileVersion.versionNumber} (${p.latestProfileVersion.status}, ${p.latestProfileVersion.profileLevel})`
        : " — todavía sin perfil visual generado";
      return `${p.displayName}${title}${roles ? ` [${roles}]` : ""}${version}`;
    });
    parts.push(`Players vinculados (${players.length}): ${lines.join("; ")}.`);
  } else {
    parts.push("Todavía no hay Players vinculados a este Estudio.");
  }

  parts.push(
    "Código local vinculado: si el usuario pide revisar/ejecutar algo en su PC, usá las herramientas de Workspace — no está precargado acá.",
  );

  return parts.join("\n");
}
