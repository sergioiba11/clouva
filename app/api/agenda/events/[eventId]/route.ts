import { NextRequest, NextResponse } from "next/server";
import { cancelAgendaEvent, updateAgendaEvent } from "@/lib/server/agenda";
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

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { eventId } = await params;
    const input = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const result = await updateAgendaEvent({ admin: createAdminSupabase(), userId: user.id, eventId, input });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "No se pudo actualizar el evento.");
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { eventId } = await params;
    const result = await cancelAgendaEvent({ admin: createAdminSupabase(), userId: user.id, eventId });
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "No se pudo cancelar el evento.");
  }
}
