import "server-only";

import { resolveAgendaAccess } from "@/lib/server/agenda";
import { getAgendaOccurrences } from "@/lib/server/agenda/recurrence";
import { createAdminSupabase } from "@/lib/server/supabase";

type AdminClient = ReturnType<typeof createAdminSupabase>;

export async function getVisibleAgendaOccurrences(args: {
  admin: AdminClient;
  userId: string;
  agendaId: string;
  from: string;
  to: string;
}) {
  const access = await resolveAgendaAccess({ admin: args.admin, userId: args.userId, agendaId: args.agendaId });
  const events = await getAgendaOccurrences(args);
  if (access.role === "owner" || access.role === "editor") return events;

  return events.filter((event) => {
    if (event.visibility === "public" || event.visibility === "connections") return true;
    return event.participants.some((participant) => participant.playerId === access.playerId);
  });
}
