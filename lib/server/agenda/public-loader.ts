import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAgendaOccurrences } from "@/lib/server/agenda/recurrence";

export type PublicAgendaEventDto = {
  title: string;
  description: string | null;
  event_type: string;
  start_at: string;
  end_at: string;
  event_timezone: string;
  all_day: boolean;
  status: "scheduled" | "completed" | "cancelled";
  location_type: "unspecified" | "physical" | "online" | "hybrid";
  location_text: string | null;
  location_url: string | null;
  recurrence_rule: string | null;
};

export type PublicAgendaPayload = {
  agenda: {
    timezone: string;
    booking_enabled: boolean;
  };
  events: PublicAgendaEventDto[];
};

type AgendaLookup =
  | { ownerPlayerId: string; ownerSpaceId?: never }
  | { ownerPlayerId?: never; ownerSpaceId: string };

async function resolveOwnerUserId(admin: SupabaseClient, agenda: { owner_player_id: string | null; owner_space_id: string | null }) {
  let playerId = agenda.owner_player_id;
  if (!playerId && agenda.owner_space_id) {
    const { data: space, error } = await admin
      .from("spaces")
      .select("owner_player_id")
      .eq("id", agenda.owner_space_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    playerId = space?.owner_player_id ? String(space.owner_player_id) : null;
  }
  if (!playerId) return null;

  const { data: player, error } = await admin
    .from("players")
    .select("owner_user_id")
    .eq("id", playerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return player?.owner_user_id ? String(player.owner_user_id) : null;
}

export async function loadCanonicalPublicAgenda(args: {
  admin: SupabaseClient;
  lookup: AgendaLookup;
  horizonDays?: number;
}): Promise<PublicAgendaPayload | null> {
  let query = args.admin
    .from("agendas")
    .select("id,owner_player_id,owner_space_id,timezone,booking_enabled")
    .eq("is_default", true)
    .eq("public_enabled", true);

  query = "ownerPlayerId" in args.lookup
    ? query.eq("owner_player_id", args.lookup.ownerPlayerId)
    : query.eq("owner_space_id", args.lookup.ownerSpaceId);

  const { data: agenda, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!agenda) return null;

  const ownerUserId = await resolveOwnerUserId(args.admin, {
    owner_player_id: agenda.owner_player_id ? String(agenda.owner_player_id) : null,
    owner_space_id: agenda.owner_space_id ? String(agenda.owner_space_id) : null,
  });
  if (!ownerUserId) return null;

  const from = new Date();
  const horizon = Math.max(1, Math.min(args.horizonDays ?? 120, 366));
  const to = new Date(from.getTime() + horizon * 86_400_000);
  const occurrences = await getAgendaOccurrences({
    admin: args.admin,
    userId: ownerUserId,
    agendaId: String(agenda.id),
    from: from.toISOString(),
    to: to.toISOString(),
  });

  const events: PublicAgendaEventDto[] = occurrences
    .filter((event) => event.status === "scheduled" && event.visibility === "public")
    .slice(0, 100)
    .map((event) => ({
      title: event.title,
      description: event.description,
      event_type: event.eventType,
      start_at: event.startAt,
      end_at: event.endAt,
      event_timezone: event.timezone,
      all_day: event.allDay,
      status: event.status,
      location_type: event.locationType,
      location_text: event.locationText,
      location_url: event.locationUrl,
      recurrence_rule: event.recurrenceRule,
    }));

  return {
    agenda: {
      timezone: String(agenda.timezone),
      booking_enabled: Boolean(agenda.booking_enabled),
    },
    events,
  };
}

export async function loadPublicAgendaByPlayer(args: { admin: SupabaseClient; playerId: string }) {
  return loadCanonicalPublicAgenda({ admin: args.admin, lookup: { ownerPlayerId: args.playerId } });
}

export async function loadPublicAgendaBySpace(args: { admin: SupabaseClient; spaceId: string }) {
  return loadCanonicalPublicAgenda({ admin: args.admin, lookup: { ownerSpaceId: args.spaceId } });
}

export async function loadPublicAgendaByStudio(args: { admin: SupabaseClient; studioId: string }) {
  const { data: space, error } = await args.admin
    .from("spaces")
    .select("id")
    .eq("legacy_studio_id", args.studioId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!space) return null;
  return loadPublicAgendaBySpace({ admin: args.admin, spaceId: String(space.id) });
}
