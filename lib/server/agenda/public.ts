import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type PublicAgendaPayload = {
  agenda: {
    id: string;
    timezone: string;
    booking_enabled: boolean;
    public_enabled: boolean;
  };
  events: Array<{
    id: string;
    title: string;
    description: string | null;
    event_type: string;
    start_at: string;
    end_at: string;
    event_timezone: string;
    all_day: boolean;
    status: string;
    location_type: string;
    location_text: string | null;
    location_url: string | null;
    recurrence_rule: string | null;
  }>;
};

export async function loadPublicAgendaBySpace(args: { admin: SupabaseClient; spaceId: string }): Promise<PublicAgendaPayload | null> {
  const { data: agenda, error } = await args.admin
    .from("agendas")
    .select("id,timezone,booking_enabled,public_enabled")
    .eq("owner_space_id", args.spaceId)
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
  if (!ids.length) return { agenda, events: [] } as PublicAgendaPayload;

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
  return { agenda, events: events ?? [] } as PublicAgendaPayload;
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
