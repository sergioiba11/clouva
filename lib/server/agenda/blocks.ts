import "server-only";

import { resolveAgendaAccess } from "@/lib/server/agenda";
import { createAdminSupabase } from "@/lib/server/supabase";

type AdminClient = ReturnType<typeof createAdminSupabase>;
type TypedError = Error & { status?: number; code?: string };

function fail(message: string, status = 400, code = "AGENDA_BLOCK_ERROR") {
  const error = new Error(message) as TypedError;
  error.status = status;
  error.code = code;
  throw error;
}

export async function createAgendaBlock(args: {
  admin: AdminClient;
  userId: string;
  agendaId: string;
  startAt: string;
  endAt: string;
  reason?: string | null;
}) {
  const access = await resolveAgendaAccess({ admin: args.admin, userId: args.userId, agendaId: args.agendaId });
  if (access.role !== "owner" && access.role !== "editor") fail("No tenés permiso para bloquear horarios.", 403, "AGENDA_BLOCK_FORBIDDEN");
  const start = new Date(args.startAt);
  const end = new Date(args.endAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) fail("El rango del bloqueo es inválido.");
  const { data, error } = await args.admin.from("agenda_blocks").insert({
    agenda_id: args.agendaId,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    reason: typeof args.reason === "string" ? args.reason.trim().slice(0, 500) || null : null,
    status: "active",
    created_by_player_id: access.playerId,
  }).select("id,agenda_id,start_at,end_at,reason,status").single();
  if (error) {
    if (/horario ya no está disponible|23P01|overlap/i.test(error.message)) fail("Ese horario ya está bloqueado.", 409, "AGENDA_BLOCK_CONFLICT");
    throw new Error(error.message);
  }
  return data;
}

export async function cancelAgendaBlock(args: { admin: AdminClient; userId: string; agendaId: string; blockId: string }) {
  const access = await resolveAgendaAccess({ admin: args.admin, userId: args.userId, agendaId: args.agendaId });
  if (access.role !== "owner" && access.role !== "editor") fail("No tenés permiso para editar bloqueos.", 403, "AGENDA_BLOCK_FORBIDDEN");
  const { data, error } = await args.admin.from("agenda_blocks")
    .update({ status: "cancelled" })
    .eq("id", args.blockId)
    .eq("agenda_id", args.agendaId)
    .select("id,status")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) fail("Bloqueo no encontrado.", 404, "AGENDA_BLOCK_NOT_FOUND");
  return data;
}
