import { NextRequest, NextResponse } from "next/server";
import { getAgendaAvailability, setAgendaAvailability } from "@/lib/server/agenda";
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
    if (!agendaId) return NextResponse.json({ error: "agendaId es obligatorio." }, { status: 400 });
    const result = await getAgendaAvailability({ admin: createAdminSupabase(), userId: user.id, agendaId });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "No se pudo cargar la disponibilidad.");
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { agendaId?: string; rules?: Array<Record<string, unknown>> };
    if (!body.agendaId || !Array.isArray(body.rules)) {
      return NextResponse.json({ error: "agendaId y rules son obligatorios." }, { status: 400 });
    }
    const result = await setAgendaAvailability({ admin: createAdminSupabase(), userId: user.id, agendaId: body.agendaId, rules: body.rules });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "No se pudo guardar la disponibilidad.");
  }
}
