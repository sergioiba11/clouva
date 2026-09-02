import { NextRequest, NextResponse } from "next/server";
import { updateAgendaSettings } from "@/lib/server/agenda/settings";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const agendaId = typeof body.agendaId === "string" ? body.agendaId : "";
    if (!agendaId) return NextResponse.json({ error: "agendaId es obligatorio." }, { status: 400 });
    const result = await updateAgendaSettings({ admin: createAdminSupabase(), userId: user.id, agendaId, input: body });
    return NextResponse.json(result);
  } catch (error) {
    const typed = error as Error & { status?: number; code?: string };
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo configurar la Agenda.", ...(typed.code ? { code: typed.code } : {}) },
      { status: typed.status ?? (isAuthError(error) ? 401 : 500) },
    );
  }
}
