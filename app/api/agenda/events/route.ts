import { NextRequest, NextResponse } from "next/server";
import { createAgendaEvent, getAgendaEvents } from "@/lib/server/agenda";
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

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const agendaId = request.nextUrl.searchParams.get("agendaId") || "";
    const from = request.nextUrl.searchParams.get("from") || "";
    const to = request.nextUrl.searchParams.get("to") || "";
    if (!agendaId || !from || !to) return NextResponse.json({ error: "agendaId, from y to son obligatorios." }, { status: 400 });
    const events = await getAgendaEvents({ admin: createAdminSupabase(), userId: user.id, agendaId, from, to });
    return NextResponse.json({ events });
  } catch (error) {
    return apiError(error, "No se pudieron cargar los eventos.");
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const agendaId = typeof body.agendaId === "string" ? body.agendaId : "";
    if (!agendaId) return NextResponse.json({ error: "agendaId es obligatorio." }, { status: 400 });
    const result = await createAgendaEvent({ admin: createAdminSupabase(), userId: user.id, agendaId, input: body });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return apiError(error, "No se pudo crear el evento.");
  }
}
