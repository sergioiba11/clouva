import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePlayerBasics } from "@/lib/server/player-basics";
import { createAdminSupabase } from "@/lib/server/supabase";

export type AgendaIdentityKind = "player" | "studio" | "business_space";
export type AgendaAccessRole = "owner" | "editor" | "participant" | "viewer";
export type AgendaRsvp = "pending" | "accepted" | "declined" | "maybe";

export type AgendaPresentation = {
  identityType: AgendaIdentityKind;
  displayName: string;
  alias: string | null;
  avatar: string | null;
  cover: string | null;
  accent: string | null;
  palette: string[];
  category: string | null;
};

export type AgendaContext = {
  agendaId: string;
  ownerPlayerId: string | null;
  ownerSpaceId: string | null;
  timezone: string;
  publicEnabled: boolean;
  bookingEnabled: boolean;
  role: AgendaAccessRole;
  presentation: AgendaPresentation;
};

export type AgendaParticipant = {
  playerId: string;
  displayName: string;
  username: string | null;
  avatar: string | null;
  role: "host" | "participant";
  rsvpStatus: AgendaRsvp;
};

export type AgendaEvent = {
  id: string;
  primaryAgendaId: string;
  title: string;
  description: string | null;
  eventType: string;
  startAt: string;
  endAt: string;
  timezone: string;
  allDay: boolean;
  status: "scheduled" | "completed" | "cancelled";
  visibility: "private" | "participants" | "connections" | "public";
  locationType: "unspecified" | "physical" | "online" | "hybrid";
  locationText: string | null;
  locationUrl: string | null;
  recurrenceRule: string | null;
  relation: "primary" | "shared" | "invited";
  participants: AgendaParticipant[];
};

type AdminClient = ReturnType<typeof createAdminSupabase>;
type TypedError = Error & { status?: number; code?: string };

type AgendaRow = {
  id: string;
  name: string;
  owner_player_id: string | null;
  owner_space_id: string | null;
  created_by_player_id: string;
  timezone: string;
  visibility: string;
  public_enabled: boolean;
  booking_enabled: boolean;
  is_default: boolean;
};

function typedError(message: string, status = 400, code = "AGENDA_ERROR") {
  const error = new Error(message) as TypedError;
  error.status = status;
  error.code = code;
  return error;
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function asIso(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw typedError(`${field} es obligatorio.`, 400, "INVALID_DATE");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw typedError(`${field} es inválido.`, 400, "INVALID_DATE");
  return date.toISOString();
}

function strongerRole(a: AgendaAccessRole | null, b: AgendaAccessRole | null): AgendaAccessRole | null {
  const rank: Record<AgendaAccessRole, number> = { owner: 4, editor: 3, participant: 2, viewer: 1 };
  if (!a) return b;
  if (!b) return a;
  return rank[a] >= rank[b] ? a : b;
}

function roleFromSpace(role: string | null | undefined): AgendaAccessRole | null {
  if (role === "owner") return "owner";
  if (role === "admin" || role === "manager") return "editor";
  if (role) return "viewer";
  return null;
}

async function loadGlobalAdmin(admin: AdminClient, userId: string) {
  const { data, error } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.role === "admin";
}

async function playerPresentation(admin: AdminClient, playerId: string): Promise<AgendaPresentation> {
  const { data, error } = await admin
    .from("players")
    .select("id,display_name,username,slug,profile_image_url,cover_url,accent_color")
    .eq("id", playerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw typedError("Player no encontrado.", 404, "PLAYER_NOT_FOUND");
  return {
    identityType: "player",
    displayName: data.display_name || data.username || "Player",
    alias: data.username || data.slug || null,
    avatar: data.profile_image_url || null,
    cover: data.cover_url || null,
    accent: data.accent_color || null,
    palette: [],
    category: null,
  };
}

async function spacePresentation(admin: AdminClient, spaceId: string): Promise<AgendaPresentation> {
  const { data: space, error } = await admin
    .from("spaces")
    .select("id,type,slug,name,logo_url,cover_url,accent_color,palette,category,legacy_studio_id")
    .eq("id", spaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!space) throw typedError("Space no encontrado.", 404, "SPACE_NOT_FOUND");

  if (space.legacy_studio_id) {
    const { data: studio } = await admin
      .from("studios")
      .select("slug,name,logo_url,cover_url,accent_color,palette")
      .eq("id", space.legacy_studio_id)
      .maybeSingle();
    if (studio) {
      return {
        identityType: "studio",
        displayName: studio.name || space.name,
        alias: studio.slug || space.slug || null,
        avatar: studio.logo_url || space.logo_url || null,
        cover: studio.cover_url || space.cover_url || null,
        accent: studio.accent_color || space.accent_color || null,
        palette: Array.isArray(studio.palette) ? studio.palette : Array.isArray(space.palette) ? space.palette : [],
        category: space.category || null,
      };
    }
  }

  return {
    identityType: "business_space",
    displayName: space.name,
    alias: space.slug || null,
    avatar: space.logo_url || null,
    cover: space.cover_url || null,
    accent: space.accent_color || null,
    palette: Array.isArray(space.palette) ? space.palette : [],
    category: space.category || null,
  };
}

async function agendaPresentation(admin: AdminClient, agenda: AgendaRow) {
  if (agenda.owner_player_id) return playerPresentation(admin, agenda.owner_player_id);
  if (agenda.owner_space_id) return spacePresentation(admin, agenda.owner_space_id);
  throw typedError("Agenda sin identidad propietaria.", 500, "AGENDA_OWNER_INVALID");
}

async function loadActor(admin: AdminClient, userId: string) {
  return requirePlayerBasics(admin, userId);
}

async function getSpaceRoleForPlayer(admin: AdminClient, spaceId: string, playerId: string) {
  const { data: space, error: spaceError } = await admin.from("spaces").select("owner_player_id").eq("id", spaceId).maybeSingle();
  if (spaceError) throw new Error(spaceError.message);
  if (!space) return null;
  if (String(space.owner_player_id) === playerId) return "owner";
  const { data: member, error } = await admin
    .from("space_members")
    .select("role,status")
    .eq("space_id", spaceId)
    .eq("player_id", playerId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return member?.role ? String(member.role) : null;
}

export async function resolveAgendaAccess(args: {
  admin: AdminClient;
  userId: string;
  agendaId: string;
}): Promise<{ agenda: AgendaRow; playerId: string; role: AgendaAccessRole }> {
  const player = await loadActor(args.admin, args.userId);
  const [{ data: agenda, error }, isGlobalAdmin] = await Promise.all([
    args.admin.from("agendas").select("*").eq("id", args.agendaId).maybeSingle(),
    loadGlobalAdmin(args.admin, args.userId),
  ]);
  if (error) throw new Error(error.message);
  if (!agenda) throw typedError("Agenda no encontrada.", 404, "AGENDA_NOT_FOUND");

  let role: AgendaAccessRole | null = isGlobalAdmin ? "owner" : null;
  const row = agenda as AgendaRow;
  if (row.owner_player_id === player.id) role = strongerRole(role, "owner");
  if (row.owner_space_id) {
    const spaceRole = await getSpaceRoleForPlayer(args.admin, row.owner_space_id, player.id);
    role = strongerRole(role, roleFromSpace(spaceRole));
  }

  const { data: member, error: memberError } = await args.admin
    .from("agenda_members")
    .select("role,status")
    .eq("agenda_id", args.agendaId)
    .eq("player_id", player.id)
    .eq("status", "active")
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (member?.role === "editor" || member?.role === "participant" || member?.role === "viewer") {
    role = strongerRole(role, member.role as AgendaAccessRole);
  }

  if (!role) throw typedError("No tenés acceso a esta Agenda.", 403, "AGENDA_FORBIDDEN");
  return { agenda: row, playerId: player.id, role };
}

export async function loadAgendaContexts(args: { admin: AdminClient; userId: string }): Promise<AgendaContext[]> {
  const player = await loadActor(args.admin, args.userId);

  const { data: memberships, error: membershipsError } = await args.admin
    .from("space_members")
    .select("space_id,role,status")
    .eq("player_id", player.id)
    .eq("status", "active");
  if (membershipsError) throw new Error(membershipsError.message);

  const memberSpaceIds = (memberships ?? []).map((row) => String(row.space_id));
  const { data: ownedSpaces, error: ownedError } = await args.admin
    .from("spaces")
    .select("id")
    .eq("owner_player_id", player.id)
    .neq("status", "archived");
  if (ownedError) throw new Error(ownedError.message);
  const spaceIds = unique([...(ownedSpaces ?? []).map((row) => String(row.id)), ...memberSpaceIds]);

  let ownAgendasQuery = args.admin
    .from("agendas")
    .select("*")
    .eq("is_default", true);
  if (spaceIds.length) {
    ownAgendasQuery = ownAgendasQuery.or(`owner_player_id.eq.${player.id},owner_space_id.in.(${spaceIds.join(",")})`);
  } else {
    ownAgendasQuery = ownAgendasQuery.eq("owner_player_id", player.id);
  }
  const { data: ownAgendas, error: ownAgendaError } = await ownAgendasQuery;
  if (ownAgendaError) throw new Error(ownAgendaError.message);

  const { data: connectionRows, error: connectionError } = await args.admin
    .from("agenda_members")
    .select("agenda_id,role,status")
    .eq("player_id", player.id)
    .eq("status", "active");
  if (connectionError) throw new Error(connectionError.message);
  const connectedIds = unique((connectionRows ?? []).map((row) => String(row.agenda_id)));

  const { data: connectedAgendas, error: connectedAgendaError } = connectedIds.length
    ? await args.admin.from("agendas").select("*").in("id", connectedIds)
    : { data: [], error: null };
  if (connectedAgendaError) throw new Error(connectedAgendaError.message);

  const all = new Map<string, AgendaRow>();
  for (const row of [...(ownAgendas ?? []), ...(connectedAgendas ?? [])]) all.set(String(row.id), row as AgendaRow);

  const contexts: AgendaContext[] = [];
  for (const agenda of all.values()) {
    let role: AgendaAccessRole | null = null;
    if (agenda.owner_player_id === player.id) role = "owner";
    if (agenda.owner_space_id) {
      const spaceRole = await getSpaceRoleForPlayer(args.admin, agenda.owner_space_id, player.id);
      role = strongerRole(role, roleFromSpace(spaceRole));
    }
    const connection = (connectionRows ?? []).find((row) => String(row.agenda_id) === agenda.id);
    if (connection?.role === "editor" || connection?.role === "participant" || connection?.role === "viewer") {
      role = strongerRole(role, connection.role as AgendaAccessRole);
    }
    if (!role) continue;
    contexts.push({
      agendaId: agenda.id,
      ownerPlayerId: agenda.owner_player_id,
      ownerSpaceId: agenda.owner_space_id,
      timezone: agenda.timezone,
      publicEnabled: agenda.public_enabled,
      bookingEnabled: agenda.booking_enabled,
      role,
      presentation: await agendaPresentation(args.admin, agenda),
    });
  }

  contexts.sort((a, b) => {
    if (a.ownerPlayerId === player.id) return -1;
    if (b.ownerPlayerId === player.id) return 1;
    return a.presentation.displayName.localeCompare(b.presentation.displayName, "es");
  });
  return contexts;
}

export async function getAgendaEvents(args: {
  admin: AdminClient;
  userId: string;
  agendaId: string;
  from: string;
  to: string;
}): Promise<AgendaEvent[]> {
  await resolveAgendaAccess(args);
  const from = asIso(args.from, "Desde");
  const to = asIso(args.to, "Hasta");
  if (new Date(to).getTime() <= new Date(from).getTime()) throw typedError("El rango de Agenda es inválido.");

  const { data: links, error: linkError } = await args.admin
    .from("agenda_event_agendas")
    .select("event_id,relation")
    .eq("agenda_id", args.agendaId);
  if (linkError) throw new Error(linkError.message);
  if (!links?.length) return [];

  const relationByEvent = new Map(links.map((link) => [String(link.event_id), String(link.relation)]));
  const eventIds = links.map((link) => String(link.event_id));
  const { data: events, error } = await args.admin
    .from("agenda_events")
    .select("*")
    .in("id", eventIds)
    .lt("start_at", to)
    .gt("end_at", from)
    .order("start_at", { ascending: true });
  if (error) throw new Error(error.message);
  if (!events?.length) return [];

  const ids = events.map((event) => String(event.id));
  const { data: participantRows, error: participantError } = await args.admin
    .from("agenda_event_participants")
    .select("event_id,player_id,role,rsvp_status")
    .in("event_id", ids);
  if (participantError) throw new Error(participantError.message);
  const playerIds = unique((participantRows ?? []).map((row) => String(row.player_id)));
  const { data: players, error: playerError } = playerIds.length
    ? await args.admin.from("players").select("id,display_name,username,profile_image_url").in("id", playerIds)
    : { data: [], error: null };
  if (playerError) throw new Error(playerError.message);
  const playerById = new Map((players ?? []).map((row) => [String(row.id), row]));

  return events.map((row) => ({
    id: String(row.id),
    primaryAgendaId: String(row.primary_agenda_id),
    title: String(row.title),
    description: row.description || null,
    eventType: String(row.event_type),
    startAt: String(row.start_at),
    endAt: String(row.end_at),
    timezone: String(row.event_timezone),
    allDay: Boolean(row.all_day),
    status: row.status,
    visibility: row.visibility,
    locationType: row.location_type,
    locationText: row.location_text || null,
    locationUrl: row.location_url || null,
    recurrenceRule: row.recurrence_rule || null,
    relation: (relationByEvent.get(String(row.id)) || "shared") as AgendaEvent["relation"],
    participants: (participantRows ?? [])
      .filter((participant) => String(participant.event_id) === String(row.id))
      .map((participant) => {
        const p = playerById.get(String(participant.player_id));
        return {
          playerId: String(participant.player_id),
          displayName: p?.display_name || p?.username || "Player",
          username: p?.username || null,
          avatar: p?.profile_image_url || null,
          role: participant.role as AgendaParticipant["role"],
          rsvpStatus: participant.rsvp_status as AgendaRsvp,
        };
      }),
  }));
}

export async function createAgendaEvent(args: {
  admin: AdminClient;
  userId: string;
  agendaId: string;
  input: Record<string, unknown>;
}) {
  const access = await resolveAgendaAccess({ admin: args.admin, userId: args.userId, agendaId: args.agendaId });
  if (access.role !== "owner" && access.role !== "editor") {
    throw typedError("No tenés permiso para crear eventos en esta Agenda.", 403, "AGENDA_EDIT_FORBIDDEN");
  }

  const title = cleanText(args.input.title, 180);
  if (!title) throw typedError("El título es obligatorio.");
  const startAt = asIso(args.input.startAt, "Inicio");
  const endAt = asIso(args.input.endAt, "Final");
  if (new Date(endAt).getTime() <= new Date(startAt).getTime()) throw typedError("La hora final debe ser posterior al inicio.");

  const eventType = cleanText(args.input.eventType, 40) || "event";
  const timezone = cleanText(args.input.timezone, 100) || access.agenda.timezone || "America/Argentina/Buenos_Aires";
  const visibilityInput = cleanText(args.input.visibility, 30);
  const visibility = (["private", "participants", "connections", "public"].includes(visibilityInput) ? visibilityInput : "private") as AgendaEvent["visibility"];
  const locationTypeInput = cleanText(args.input.locationType, 30);
  const locationType = (["unspecified", "physical", "online", "hybrid"].includes(locationTypeInput) ? locationTypeInput : "unspecified") as AgendaEvent["locationType"];
  const recurrenceRule = cleanText(args.input.recurrenceRule, 1000) || null;

  const { data: event, error } = await args.admin
    .from("agenda_events")
    .insert({
      primary_agenda_id: args.agendaId,
      created_by_player_id: access.playerId,
      title,
      description: cleanText(args.input.description, 6000) || null,
      event_type: eventType,
      start_at: startAt,
      end_at: endAt,
      event_timezone: timezone,
      all_day: args.input.allDay === true,
      status: "scheduled",
      visibility,
      location_type: locationType,
      location_text: cleanText(args.input.locationText, 500) || null,
      location_url: cleanText(args.input.locationUrl, 1200) || null,
      recurrence_rule: recurrenceRule,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const eventId = String(event.id);
  await args.admin.from("agenda_event_agendas").insert({ event_id: eventId, agenda_id: args.agendaId, relation: "primary" });

  const participantIds = unique([
    access.playerId,
    ...((Array.isArray(args.input.participantPlayerIds) ? args.input.participantPlayerIds : [])
      .filter(isUuid) as string[]),
  ]);

  if (participantIds.length) {
    const participantRows = participantIds.map((playerId) => ({
      event_id: eventId,
      player_id: playerId,
      role: playerId === access.playerId ? "host" : "participant",
      rsvp_status: playerId === access.playerId ? "accepted" : "pending",
      invited_by_player_id: access.playerId,
    }));
    const { error: participantError } = await args.admin.from("agenda_event_participants").upsert(participantRows, { onConflict: "event_id,player_id" });
    if (participantError) throw new Error(participantError.message);

    const { data: playerAgendas, error: playerAgendaError } = await args.admin
      .from("agendas")
      .select("id,owner_player_id")
      .in("owner_player_id", participantIds)
      .eq("is_default", true);
    if (playerAgendaError) throw new Error(playerAgendaError.message);
    const links = (playerAgendas ?? [])
      .filter((agenda) => String(agenda.id) !== args.agendaId)
      .map((agenda) => ({ event_id: eventId, agenda_id: agenda.id, relation: "invited" }));
    if (links.length) {
      const { error: linksError } = await args.admin.from("agenda_event_agendas").upsert(links, { onConflict: "event_id,agenda_id" });
      if (linksError) throw new Error(linksError.message);
    }
  }

  const shareAgendaIds = unique((Array.isArray(args.input.shareAgendaIds) ? args.input.shareAgendaIds : []).filter(isUuid) as string[])
    .filter((id) => id !== args.agendaId);
  for (const shareAgendaId of shareAgendaIds) {
    const shareAccess = await resolveAgendaAccess({ admin: args.admin, userId: args.userId, agendaId: shareAgendaId });
    if (shareAccess.role !== "owner" && shareAccess.role !== "editor") continue;
    await args.admin.from("agenda_event_agendas").upsert(
      { event_id: eventId, agenda_id: shareAgendaId, relation: "shared" },
      { onConflict: "event_id,agenda_id" },
    );
  }

  return { eventId };
}

async function resolveEventManager(admin: AdminClient, userId: string, eventId: string) {
  const { data: event, error } = await admin.from("agenda_events").select("id,primary_agenda_id").eq("id", eventId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!event) throw typedError("Evento no encontrado.", 404, "EVENT_NOT_FOUND");
  const access = await resolveAgendaAccess({ admin, userId, agendaId: String(event.primary_agenda_id) });
  if (access.role !== "owner" && access.role !== "editor") {
    throw typedError("No tenés permiso para modificar este evento.", 403, "EVENT_EDIT_FORBIDDEN");
  }
  return { event, access };
}

export async function updateAgendaEvent(args: {
  admin: AdminClient;
  userId: string;
  eventId: string;
  input: Record<string, unknown>;
}) {
  await resolveEventManager(args.admin, args.userId, args.eventId);
  const patch: Record<string, unknown> = {};
  if (args.input.title !== undefined) {
    const title = cleanText(args.input.title, 180);
    if (!title) throw typedError("El título es obligatorio.");
    patch.title = title;
  }
  if (args.input.description !== undefined) patch.description = cleanText(args.input.description, 6000) || null;
  if (args.input.startAt !== undefined) patch.start_at = asIso(args.input.startAt, "Inicio");
  if (args.input.endAt !== undefined) patch.end_at = asIso(args.input.endAt, "Final");
  if (args.input.eventType !== undefined) patch.event_type = cleanText(args.input.eventType, 40) || "event";
  if (args.input.timezone !== undefined) patch.event_timezone = cleanText(args.input.timezone, 100) || "America/Argentina/Buenos_Aires";
  if (args.input.allDay !== undefined) patch.all_day = args.input.allDay === true;
  if (args.input.locationText !== undefined) patch.location_text = cleanText(args.input.locationText, 500) || null;
  if (args.input.locationUrl !== undefined) patch.location_url = cleanText(args.input.locationUrl, 1200) || null;
  if (args.input.recurrenceRule !== undefined) patch.recurrence_rule = cleanText(args.input.recurrenceRule, 1000) || null;
  if (args.input.visibility !== undefined) {
    const value = cleanText(args.input.visibility, 30);
    if (!["private", "participants", "connections", "public"].includes(value)) throw typedError("Visibilidad inválida.");
    patch.visibility = value;
  }
  if (args.input.locationType !== undefined) {
    const value = cleanText(args.input.locationType, 30);
    if (!["unspecified", "physical", "online", "hybrid"].includes(value)) throw typedError("Tipo de ubicación inválido.");
    patch.location_type = value;
  }

  if (patch.start_at || patch.end_at) {
    const { data: current, error } = await args.admin.from("agenda_events").select("start_at,end_at").eq("id", args.eventId).single();
    if (error) throw new Error(error.message);
    const start = String(patch.start_at || current.start_at);
    const end = String(patch.end_at || current.end_at);
    if (new Date(end).getTime() <= new Date(start).getTime()) throw typedError("La hora final debe ser posterior al inicio.");
  }

  const { error } = await args.admin.from("agenda_events").update(patch).eq("id", args.eventId);
  if (error) throw new Error(error.message);
  return { eventId: args.eventId };
}

export async function cancelAgendaEvent(args: { admin: AdminClient; userId: string; eventId: string }) {
  await resolveEventManager(args.admin, args.userId, args.eventId);
  const { error } = await args.admin.from("agenda_events").update({ status: "cancelled" }).eq("id", args.eventId);
  if (error) throw new Error(error.message);
  await args.admin.from("agenda_blocks").update({ status: "cancelled" }).eq("event_id", args.eventId).eq("status", "active");
  return { eventId: args.eventId, status: "cancelled" as const };
}

export async function respondEventInvitation(args: {
  admin: AdminClient;
  userId: string;
  eventId: string;
  rsvpStatus: AgendaRsvp;
}) {
  if (!["pending", "accepted", "declined", "maybe"].includes(args.rsvpStatus)) throw typedError("RSVP inválido.");
  const player = await loadActor(args.admin, args.userId);
  const { data, error } = await args.admin
    .from("agenda_event_participants")
    .update({ rsvp_status: args.rsvpStatus })
    .eq("event_id", args.eventId)
    .eq("player_id", player.id)
    .select("event_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw typedError("No estás invitado a este evento.", 403, "EVENT_RSVP_FORBIDDEN");
  return { eventId: args.eventId, rsvpStatus: args.rsvpStatus };
}

export async function inviteAgendaMember(args: {
  admin: AdminClient;
  userId: string;
  agendaId: string;
  playerId: string;
  role: "viewer" | "participant" | "editor";
}) {
  const access = await resolveAgendaAccess({ admin: args.admin, userId: args.userId, agendaId: args.agendaId });
  if (access.role !== "owner" && access.role !== "editor") throw typedError("No podés compartir esta Agenda.", 403, "AGENDA_SHARE_FORBIDDEN");
  if (!isUuid(args.playerId) || !["viewer", "participant", "editor"].includes(args.role)) throw typedError("Invitación inválida.");
  if (args.playerId === access.playerId) throw typedError("Tu Player ya tiene acceso a esta Agenda.");
  const { error } = await args.admin.from("agenda_members").upsert({
    agenda_id: args.agendaId,
    player_id: args.playerId,
    role: args.role,
    status: "pending",
    invited_by_player_id: access.playerId,
  }, { onConflict: "agenda_id,player_id" });
  if (error) throw new Error(error.message);
  return { agendaId: args.agendaId, playerId: args.playerId, status: "pending" as const };
}

export async function respondAgendaInvite(args: {
  admin: AdminClient;
  userId: string;
  agendaId: string;
  accept: boolean;
}) {
  const player = await loadActor(args.admin, args.userId);
  const nextStatus = args.accept ? "active" : "declined";
  const { data, error } = await args.admin
    .from("agenda_members")
    .update({ status: nextStatus })
    .eq("agenda_id", args.agendaId)
    .eq("player_id", player.id)
    .eq("status", "pending")
    .select("agenda_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw typedError("No hay una invitación pendiente para esta Agenda.", 404, "AGENDA_INVITE_NOT_FOUND");
  return { agendaId: args.agendaId, status: nextStatus };
}

export async function getAgendaAvailability(args: {
  admin: AdminClient;
  userId: string;
  agendaId: string;
}) {
  await resolveAgendaAccess(args);
  const [{ data: rules, error: rulesError }, { data: blocks, error: blocksError }] = await Promise.all([
    args.admin.from("agenda_availability_rules").select("*").eq("agenda_id", args.agendaId).order("weekday").order("start_local"),
    args.admin.from("agenda_blocks").select("*").eq("agenda_id", args.agendaId).eq("status", "active").gte("end_at", new Date().toISOString()).order("start_at").limit(200),
  ]);
  if (rulesError) throw new Error(rulesError.message);
  if (blocksError) throw new Error(blocksError.message);
  return { rules: rules ?? [], blocks: blocks ?? [] };
}

export async function setAgendaAvailability(args: {
  admin: AdminClient;
  userId: string;
  agendaId: string;
  rules: Array<Record<string, unknown>>;
}) {
  const access = await resolveAgendaAccess({ admin: args.admin, userId: args.userId, agendaId: args.agendaId });
  if (access.role !== "owner" && access.role !== "editor") throw typedError("No podés editar la disponibilidad.", 403, "AGENDA_EDIT_FORBIDDEN");

  const rows = args.rules.slice(0, 64).map((rule) => {
    const weekday = Number(rule.weekday);
    const startLocal = cleanText(rule.startLocal, 8);
    const endLocal = cleanText(rule.endLocal, 8);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !/^\d{2}:\d{2}(:\d{2})?$/.test(startLocal) || !/^\d{2}:\d{2}(:\d{2})?$/.test(endLocal)) {
      throw typedError("Regla de disponibilidad inválida.");
    }
    return {
      agenda_id: args.agendaId,
      weekday,
      start_local: startLocal,
      end_local: endLocal,
      timezone: cleanText(rule.timezone, 100) || access.agenda.timezone,
      valid_from: cleanText(rule.validFrom, 10) || null,
      valid_until: cleanText(rule.validUntil, 10) || null,
      is_available: rule.isAvailable !== false,
    };
  });

  const { error: deleteError } = await args.admin.from("agenda_availability_rules").delete().eq("agenda_id", args.agendaId);
  if (deleteError) throw new Error(deleteError.message);
  if (rows.length) {
    const { error } = await args.admin.from("agenda_availability_rules").insert(rows);
    if (error) throw new Error(error.message);
  }
  return { agendaId: args.agendaId, rules: rows.length };
}

export async function loadPublicAgendaByPlayer(args: { admin: SupabaseClient; playerId: string }) {
  const { data: agenda, error } = await args.admin
    .from("agendas")
    .select("id,timezone,booking_enabled,public_enabled")
    .eq("owner_player_id", args.playerId)
    .eq("is_default", true)
    .eq("public_enabled", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!agenda) return null;

  const now = new Date();
  const until = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 120);
  const { data: links, error: linksError } = await args.admin
    .from("agenda_event_agendas")
    .select("event_id")
    .eq("agenda_id", agenda.id);
  if (linksError) throw new Error(linksError.message);
  const ids = (links ?? []).map((row) => String(row.event_id));
  if (!ids.length) return { agenda, events: [] };
  const { data: events, error: eventError } = await args.admin
    .from("agenda_events")
    .select("id,title,description,event_type,start_at,end_at,event_timezone,all_day,status,location_type,location_text,location_url,recurrence_rule")
    .in("id", ids)
    .eq("visibility", "public")
    .eq("status", "scheduled")
    .gte("end_at", now.toISOString())
    .lt("start_at", until.toISOString())
    .order("start_at")
    .limit(100);
  if (eventError) throw new Error(eventError.message);
  return { agenda, events: events ?? [] };
}
