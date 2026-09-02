import { NextRequest, NextResponse } from "next/server";
import { inviteAgendaMember, respondAgendaInvite } from "@/lib/server/agenda";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function apiError(error: unknown, fallback: string) {
  const typed = error as Error & { status?: number; code?: string };
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback, ...(typed.code ? { code: typed.code } : {}) },
    { status: typed.status ?? (isAuthError(error) ? 401 : 500) },
  );
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      agendaId?: string;
      playerId?: string;
      role?: "viewer" | "participant" | "editor";
    };
    if (!body.agendaId || !body.playerId || !body.role) {
      return NextResponse.json({ error: "agendaId, playerId y role son obligatorios." }, { status: 400 });
    }
    const result = await inviteAgendaMember({
      admin: createAdminSupabase(),
      userId: user.id,
      agendaId: body.agendaId,
      playerId: body.playerId,
      role: body.role,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return apiError(error, "No se pudo conectar la Agenda.");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { agendaId?: string; accept?: boolean };
    if (!body.agendaId || typeof body.accept !== "boolean") {
      return NextResponse.json({ error: "agendaId y accept son obligatorios." }, { status: 400 });
    }
    const result = await respondAgendaInvite({
      admin: createAdminSupabase(),
      userId: user.id,
      agendaId: body.agendaId,
      accept: body.accept,
    });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "No se pudo responder la conexión.");
  }
}
