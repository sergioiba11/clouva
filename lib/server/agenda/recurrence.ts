import "server-only";

import { resolveAgendaAccess, type AgendaEvent, type AgendaParticipant } from "@/lib/server/agenda";
import { createAdminSupabase } from "@/lib/server/supabase";

type AdminClient = ReturnType<typeof createAdminSupabase>;
type RRule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
  byDay: number[];
  count: number | null;
  until: Date | null;
};
type WallParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };
type RawEvent = {
  id: string;
  primary_agenda_id: string;
  title: string;
  description: string | null;
  event_type: string;
  start_at: string;
  end_at: string;
  event_timezone: string;
  all_day: boolean;
  status: "scheduled" | "completed" | "cancelled";
  visibility: "private" | "participants" | "connections" | "public";
  location_type: "unspecified" | "physical" | "online" | "hybrid";
  location_text: string | null;
  location_url: string | null;
  recurrence_rule: string | null;
};

const DAY_MS = 86_400_000;
const DAY_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRRule(value: string | null): RRule | null {
  if (!value) return null;
  const entries = new Map<string, string>();
  for (const part of value.trim().replace(/^RRULE:/i, "").split(";")) {
    const [rawKey, ...rest] = part.split("=");
    if (!rawKey || !rest.length) continue;
    entries.set(rawKey.trim().toUpperCase(), rest.join("=").trim().toUpperCase());
  }
  const freq = entries.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY") return null;
  const intervalRaw = Number(entries.get("INTERVAL") || "1");
  const interval = Number.isInteger(intervalRaw) && intervalRaw > 0 ? Math.min(intervalRaw, 366) : 1;
  const countRaw = Number(entries.get("COUNT") || "");
  const count = Number.isInteger(countRaw) && countRaw > 0 ? Math.min(countRaw, 10000) : null;
  const byDay = (entries.get("BYDAY") || "")
    .split(",")
    .map((day) => DAY_INDEX[day.replace(/^[-+]?\d+/, "")])
    .filter((day): day is number => Number.isInteger(day));
  const untilRaw = entries.get("UNTIL") || "";
  let until: Date | null = null;
  if (untilRaw) {
    const compact = untilRaw.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?$/);
    if (compact) {
      until = new Date(Date.UTC(
        Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]),
        Number(compact[4] || 23), Number(compact[5] || 59), Number(compact[6] || 59),
      ));
    } else {
      const parsed = new Date(untilRaw);
      if (Number.isFinite(parsed.getTime())) until = parsed;
    }
  }
  return { freq, interval, byDay, count, until };
}

function zonedParts(date: Date, timeZone: string): WallParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || "0");
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

function wallStamp(parts: WallParts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function zonedToUtc(parts: WallParts, timeZone: string) {
  let guess = new Date(wallStamp(parts));
  for (let index = 0; index < 4; index += 1) {
    const actual = zonedParts(guess, timeZone);
    const delta = wallStamp(parts) - wallStamp(actual);
    if (!delta) break;
    guess = new Date(guess.getTime() + delta);
  }
  return guess;
}

function wallDate(parts: WallParts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function withWallDate(base: WallParts, date: Date): WallParts {
  return {
    year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
    hour: base.hour, minute: base.minute, second: base.second,
  };
}

function validSameDay(parts: WallParts, expectedDay: number) {
  return parts.day === expectedDay;
}

function occurrenceStarts(event: RawEvent, rangeFrom: Date, rangeTo: Date) {
  const rule = parseRRule(event.recurrence_rule);
  if (!rule) return [];
  const baseStart = new Date(event.start_at);
  if (!Number.isFinite(baseStart.getTime()) || baseStart >= rangeTo) return [];
  const zone = event.event_timezone || "UTC";
  const base = zonedParts(baseStart, zone);
  const baseWallDate = wallDate(base);
  const starts: Date[] = [];
  let emitted = 0;
  let safety = 0;

  const accept = (candidate: Date) => {
    if (rule.until && candidate > rule.until) return false;
    emitted += 1;
    if (rule.count && emitted > rule.count) return false;
    if (candidate >= rangeFrom && candidate < rangeTo) starts.push(candidate);
    return !rule.count || emitted < rule.count;
  };

  if (rule.freq === "DAILY") {
    for (let offset = 0; safety < 10000; offset += rule.interval, safety += 1) {
      const localDate = new Date(baseWallDate.getTime());
      localDate.setUTCDate(localDate.getUTCDate() + offset);
      const candidate = zonedToUtc(withWallDate(base, localDate), zone);
      if (candidate >= rangeTo && emitted > 0) break;
      if (!accept(candidate)) break;
    }
    return starts;
  }

  if (rule.freq === "MONTHLY") {
    for (let offset = 0; safety < 2400; offset += rule.interval, safety += 1) {
      const monthAnchor = new Date(Date.UTC(base.year, base.month - 1 + offset, 1));
      const desired: WallParts = {
        year: monthAnchor.getUTCFullYear(), month: monthAnchor.getUTCMonth() + 1, day: base.day,
        hour: base.hour, minute: base.minute, second: base.second,
      };
      if (!validSameDay(desired, base.day)) continue;
      const probe = new Date(Date.UTC(desired.year, desired.month - 1, desired.day));
      if (probe.getUTCMonth() + 1 !== desired.month) continue;
      const candidate = zonedToUtc(desired, zone);
      if (candidate >= rangeTo && emitted > 0) break;
      if (!accept(candidate)) break;
    }
    return starts;
  }

  const baseWeekday = baseWallDate.getUTCDay();
  const weekdays = rule.byDay.length ? Array.from(new Set(rule.byDay)).sort((a, b) => a - b) : [baseWeekday];
  for (let dayOffset = 0; safety < 10000; dayOffset += 1, safety += 1) {
    const localDate = new Date(baseWallDate.getTime() + dayOffset * DAY_MS);
    const weeksSinceBase = Math.floor(dayOffset / 7);
    if (weeksSinceBase % rule.interval !== 0 || !weekdays.includes(localDate.getUTCDay())) continue;
    const candidate = zonedToUtc(withWallDate(base, localDate), zone);
    if (candidate < baseStart) continue;
    if (candidate >= rangeTo && emitted > 0) break;
    if (!accept(candidate)) break;
  }
  return starts;
}

function relationMap(rows: Array<{ event_id: string; relation: string }>) {
  return new Map(rows.map((row) => [String(row.event_id), row.relation as AgendaEvent["relation"]]));
}

export async function getAgendaOccurrences(args: {
  admin: AdminClient;
  userId: string;
  agendaId: string;
  from: string;
  to: string;
}): Promise<Array<AgendaEvent & { seriesEventId: string; occurrenceStartAt: string }>> {
  await resolveAgendaAccess({ admin: args.admin, userId: args.userId, agendaId: args.agendaId });
  const from = new Date(args.from);
  const to = new Date(args.to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) throw new Error("El rango de Agenda es inválido.");

  const { data: links, error: linkError } = await args.admin
    .from("agenda_event_agendas")
    .select("event_id,relation")
    .eq("agenda_id", args.agendaId);
  if (linkError) throw new Error(linkError.message);
  if (!links?.length) return [];
  const ids = links.map((row) => String(row.event_id));
  const relations = relationMap(links as Array<{ event_id: string; relation: string }>);

  const events: RawEvent[] = [];
  for (let index = 0; index < ids.length; index += 400) {
    const batch = ids.slice(index, index + 400);
    const { data, error } = await args.admin.from("agenda_events").select("*").in("id", batch);
    if (error) throw new Error(error.message);
    events.push(...((data ?? []) as RawEvent[]));
  }

  const eventIds = events.map((event) => event.id);
  const [{ data: participants, error: participantError }, { data: exceptions, error: exceptionError }] = await Promise.all([
    eventIds.length ? args.admin.from("agenda_event_participants").select("event_id,player_id,role,rsvp_status").in("event_id", eventIds) : Promise.resolve({ data: [], error: null }),
    eventIds.length ? args.admin.from("agenda_event_exceptions").select("series_event_id,occurrence_start_at,action,override_event_id").in("series_event_id", eventIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (participantError) throw new Error(participantError.message);
  if (exceptionError) throw new Error(exceptionError.message);

  const playerIds = Array.from(new Set((participants ?? []).map((row) => String(row.player_id))));
  const { data: players, error: playerError } = playerIds.length
    ? await args.admin.from("players").select("id,display_name,username,profile_image_url").in("id", playerIds)
    : { data: [], error: null };
  if (playerError) throw new Error(playerError.message);
  const playerById = new Map((players ?? []).map((player) => [String(player.id), player]));

  const overrideIds = Array.from(new Set((exceptions ?? []).map((row) => row.override_event_id ? String(row.override_event_id) : "").filter(Boolean)));
  const { data: overrideRows, error: overrideError } = overrideIds.length
    ? await args.admin.from("agenda_events").select("*").in("id", overrideIds)
    : { data: [], error: null };
  if (overrideError) throw new Error(overrideError.message);
  const overrideById = new Map((overrideRows ?? []).map((row) => [String(row.id), row as RawEvent]));

  const participantsFor = (eventId: string): AgendaParticipant[] => (participants ?? [])
    .filter((row) => String(row.event_id) === eventId)
    .map((row) => {
      const player = playerById.get(String(row.player_id));
      return {
        playerId: String(row.player_id),
        displayName: player?.display_name || player?.username || "Player",
        username: player?.username || null,
        avatar: player?.profile_image_url || null,
        role: row.role as AgendaParticipant["role"],
        rsvpStatus: row.rsvp_status as AgendaParticipant["rsvpStatus"],
      };
    });

  const output: Array<AgendaEvent & { seriesEventId: string; occurrenceStartAt: string }> = [];
  const push = (event: RawEvent, seriesEventId: string, occurrenceStart: Date, occurrenceEnd: Date, relation: AgendaEvent["relation"], participantSource = seriesEventId) => {
    const recurringInstance = Boolean(events.find((candidate) => candidate.id === seriesEventId)?.recurrence_rule);
    output.push({
      id: recurringInstance ? `${seriesEventId}__${occurrenceStart.getTime()}` : event.id,
      primaryAgendaId: event.primary_agenda_id,
      title: event.title,
      description: event.description,
      eventType: event.event_type,
      startAt: occurrenceStart.toISOString(),
      endAt: occurrenceEnd.toISOString(),
      timezone: event.event_timezone,
      allDay: event.all_day,
      status: event.status,
      visibility: event.visibility,
      locationType: event.location_type,
      locationText: event.location_text,
      locationUrl: event.location_url,
      recurrenceRule: event.recurrence_rule,
      relation,
      participants: participantsFor(participantSource),
      seriesEventId,
      occurrenceStartAt: occurrenceStart.toISOString(),
    });
  };

  for (const event of events) {
    if (event.status === "cancelled") continue;
    const relation = relations.get(event.id) || "shared";
    const baseStart = new Date(event.start_at);
    const baseEnd = new Date(event.end_at);
    const duration = baseEnd.getTime() - baseStart.getTime();
    if (!event.recurrence_rule) {
      if (baseStart < to && baseEnd > from) push(event, event.id, baseStart, baseEnd, relation);
      continue;
    }

    const eventExceptions = (exceptions ?? []).filter((row) => String(row.series_event_id) === event.id);
    const exceptionByStart = new Map(eventExceptions.map((row) => [new Date(String(row.occurrence_start_at)).toISOString(), row]));
    for (const occurrenceStart of occurrenceStarts(event, from, to)) {
      const key = occurrenceStart.toISOString();
      const exception = exceptionByStart.get(key);
      if (exception?.action === "cancelled") continue;
      if (exception?.action === "modified" && exception.override_event_id) {
        const override = overrideById.get(String(exception.override_event_id));
        if (override && override.status !== "cancelled") {
          push(override, event.id, new Date(override.start_at), new Date(override.end_at), relation, event.id);
          continue;
        }
      }
      push(event, event.id, occurrenceStart, new Date(occurrenceStart.getTime() + duration), relation);
    }
  }

  return output.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
}

function canonicalEventId(eventId: string) {
  return eventId.split("__", 1)[0];
}

export async function mutateAgendaOccurrence(args: {
  admin: AdminClient;
  userId: string;
  eventId: string;
  occurrenceStartAt: string;
  action: "cancel" | "modify";
  input?: Record<string, unknown>;
}) {
  const seriesEventId = canonicalEventId(args.eventId);
  const { data: series, error } = await args.admin.from("agenda_events").select("*").eq("id", seriesEventId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!series) throw new Error("Serie no encontrada.");
  if (!series.recurrence_rule) throw new Error("El evento no es recurrente.");
  const access = await resolveAgendaAccess({ admin: args.admin, userId: args.userId, agendaId: String(series.primary_agenda_id) });
  if (access.role !== "owner" && access.role !== "editor") throw new Error("No tenés permiso para modificar esta serie.");

  const occurrenceStart = new Date(args.occurrenceStartAt);
  if (!Number.isFinite(occurrenceStart.getTime())) throw new Error("Ocurrencia inválida.");

  if (args.action === "cancel") {
    const { error: upsertError } = await args.admin.from("agenda_event_exceptions").upsert({
      series_event_id: seriesEventId,
      occurrence_start_at: occurrenceStart.toISOString(),
      action: "cancelled",
      override_event_id: null,
      created_by_player_id: access.playerId,
    }, { onConflict: "series_event_id,occurrence_start_at" });
    if (upsertError) throw new Error(upsertError.message);
    return { seriesEventId, occurrenceStartAt: occurrenceStart.toISOString(), action: "cancelled" as const };
  }

  const input = args.input ?? {};
  const originalStart = new Date(series.start_at);
  const originalEnd = new Date(series.end_at);
  const duration = originalEnd.getTime() - originalStart.getTime();
  const nextStart = input.startAt ? new Date(String(input.startAt)) : occurrenceStart;
  const nextEnd = input.endAt ? new Date(String(input.endAt)) : new Date(nextStart.getTime() + duration);
  if (!Number.isFinite(nextStart.getTime()) || !Number.isFinite(nextEnd.getTime()) || nextEnd <= nextStart) throw new Error("Horario de ocurrencia inválido.");

  const { data: override, error: overrideError } = await args.admin.from("agenda_events").insert({
    primary_agenda_id: series.primary_agenda_id,
    created_by_player_id: access.playerId,
    title: typeof input.title === "string" && input.title.trim() ? input.title.trim().slice(0, 180) : series.title,
    description: typeof input.description === "string" ? input.description.trim().slice(0, 6000) || null : series.description,
    event_type: series.event_type,
    start_at: nextStart.toISOString(),
    end_at: nextEnd.toISOString(),
    event_timezone: series.event_timezone,
    all_day: series.all_day,
    status: series.status,
    visibility: series.visibility,
    location_type: series.location_type,
    location_text: typeof input.locationText === "string" ? input.locationText.trim().slice(0, 500) || null : series.location_text,
    location_url: typeof input.locationUrl === "string" ? input.locationUrl.trim().slice(0, 1200) || null : series.location_url,
    recurrence_rule: null,
    metadata: { series_event_id: seriesEventId, occurrence_start_at: occurrenceStart.toISOString() },
  }).select("id").single();
  if (overrideError) throw new Error(overrideError.message);

  const { data: agendaLinks, error: linksError } = await args.admin.from("agenda_event_agendas").select("agenda_id,relation").eq("event_id", seriesEventId);
  if (linksError) throw new Error(linksError.message);
  if (agendaLinks?.length) {
    const { error: copyLinkError } = await args.admin.from("agenda_event_agendas").insert(agendaLinks.map((row) => ({ event_id: override.id, agenda_id: row.agenda_id, relation: row.relation })));
    if (copyLinkError) throw new Error(copyLinkError.message);
  }

  const { error: exceptionUpsertError } = await args.admin.from("agenda_event_exceptions").upsert({
    series_event_id: seriesEventId,
    occurrence_start_at: occurrenceStart.toISOString(),
    action: "modified",
    override_event_id: override.id,
    created_by_player_id: access.playerId,
  }, { onConflict: "series_event_id,occurrence_start_at" });
  if (exceptionUpsertError) throw new Error(exceptionUpsertError.message);

  return { seriesEventId, occurrenceStartAt: occurrenceStart.toISOString(), action: "modified" as const, overrideEventId: String(override.id) };
}

export { canonicalEventId };
