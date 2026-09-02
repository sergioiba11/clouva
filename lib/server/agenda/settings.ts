import "server-only";

import { requirePlayerBasics } from "@/lib/server/player-basics";
import { resolveAgendaAccess, type AgendaAccessRole } from "@/lib/server/agenda";
import { createAdminSupabase } from "@/lib/server/supabase";

type AdminClient = ReturnType<typeof createAdminSupabase>;
type TypedError = Error & { status?: number; code?: string };

function typedError(message: string, status = 400, code = "AGENDA_SETTINGS_ERROR") {
  const error = new Error(message) as TypedError;
  error.status = status;
  error.code = code;
  return error;
}

export async function updateAgendaSettings(args: {
  admin: AdminClient;
  userId: string;
  agendaId: string;
  input: Record<string, unknown>;
}) {
  const access = await resolveAgendaAccess({ admin: args.admin, userId: args.userId, agendaId: args.agendaId });
  if (access.role !== "owner" && access.role !== "editor") {
    throw typedError("No tenés permiso para configurar esta Agenda.", 403, "AGENDA_SETTINGS_FORBIDDEN");
  }

  const patch: Record<string, unknown> = {};
  if (typeof args.input.name === "string") {
    const name = args.input.name.trim().slice(0, 160);
    if (!name) throw typedError("El nombre de la Agenda no puede quedar vacío.");
    patch.name = name;
  }
  if (typeof args.input.timezone === "string") {
    const timezone = args.input.timezone.trim().slice(0, 100);
    if (!timezone || !timezone.includes("/")) throw typedError("Timezone IANA inválido.");
    patch.timezone = timezone;
  }
  if (typeof args.input.visibility === "string") {
    const visibility = args.input.visibility;
    if (!["private", "connections", "public"].includes(visibility)) throw typedError("Visibilidad inválida.");
    patch.visibility = visibility;
  }
  if (typeof args.input.publicEnabled === "boolean") patch.public_enabled = args.input.publicEnabled;
  if (typeof args.input.bookingEnabled === "boolean") patch.booking_enabled = args.input.bookingEnabled;

  if (!Object.keys(patch).length) return { agendaId: args.agendaId, changed: false };
  const { data, error } = await args.admin
    .from("agendas")
    .update(patch)
    .eq("id", args.agendaId)
    .select("id,name,timezone,visibility,public_enabled,booking_enabled")
    .single();
  if (error) throw new Error(error.message);
  return { agenda: data, changed: true };
}

export async function listAgendaConnections(args: {
  admin: AdminClient;
  userId: string;
  agendaId: string;
}) {
  const access = await resolveAgendaAccess({ admin: args.admin, userId: args.userId, agendaId: args.agendaId });
  if (access.role !== "owner" && access.role !== "editor") {
    throw typedError("No tenés permiso para ver las conexiones de esta Agenda.", 403, "AGENDA_CONNECTIONS_FORBIDDEN");
  }
  const { data: members, error } = await args.admin
    .from("agenda_members")
    .select("agenda_id,player_id,role,status,invited_by_player_id,created_at,updated_at")
    .eq("agenda_id", args.agendaId)
    .neq("status", "revoked")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const playerIds = Array.from(new Set((members ?? []).flatMap((member) => [String(member.player_id), member.invited_by_player_id ? String(member.invited_by_player_id) : ""]).filter(Boolean)));
  const { data: players, error: playerError } = playerIds.length
    ? await args.admin.from("players").select("id,display_name,username,profile_image_url").in("id", playerIds)
    : { data: [], error: null };
  if (playerError) throw new Error(playerError.message);
  const byId = new Map((players ?? []).map((player) => [String(player.id), player]));
  return (members ?? []).map((member) => {
    const player = byId.get(String(member.player_id));
    const inviter = member.invited_by_player_id ? byId.get(String(member.invited_by_player_id)) : null;
    return {
      agendaId: String(member.agenda_id),
      playerId: String(member.player_id),
      displayName: player?.display_name || player?.username || "Player",
      username: player?.username || null,
      avatar: player?.profile_image_url || null,
      role: member.role as AgendaAccessRole,
      status: String(member.status),
      invitedBy: inviter ? { displayName: inviter.display_name || inviter.username || "Player", username: inviter.username || null } : null,
      createdAt: String(member.created_at),
    };
  });
}

export async function listPendingAgendaInvites(args: { admin: AdminClient; userId: string }) {
  const player = await requirePlayerBasics(args.admin, args.userId);
  const { data: invites, error } = await args.admin
    .from("agenda_members")
    .select("agenda_id,role,status,invited_by_player_id,created_at")
    .eq("player_id", player.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  if (!invites?.length) return [];

  const agendaIds = invites.map((invite) => String(invite.agenda_id));
  const inviterIds = Array.from(new Set(invites.map((invite) => invite.invited_by_player_id ? String(invite.invited_by_player_id) : "").filter(Boolean)));
  const [{ data: agendas, error: agendaError }, { data: inviters, error: inviterError }] = await Promise.all([
    args.admin.from("agendas").select("id,name,owner_player_id,owner_space_id").in("id", agendaIds),
    inviterIds.length ? args.admin.from("players").select("id,display_name,username,profile_image_url").in("id", inviterIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (agendaError) throw new Error(agendaError.message);
  if (inviterError) throw new Error(inviterError.message);

  const agendaById = new Map((agendas ?? []).map((agenda) => [String(agenda.id), agenda]));
  const inviterById = new Map((inviters ?? []).map((inviter) => [String(inviter.id), inviter]));
  return invites.map((invite) => {
    const agenda = agendaById.get(String(invite.agenda_id));
    const inviter = invite.invited_by_player_id ? inviterById.get(String(invite.invited_by_player_id)) : null;
    return {
      agendaId: String(invite.agenda_id),
      agendaName: agenda?.name || "Agenda",
      role: String(invite.role),
      createdAt: String(invite.created_at),
      inviter: inviter ? {
        displayName: inviter.display_name || inviter.username || "Player",
        username: inviter.username || null,
        avatar: inviter.profile_image_url || null,
      } : null,
    };
  });
}
