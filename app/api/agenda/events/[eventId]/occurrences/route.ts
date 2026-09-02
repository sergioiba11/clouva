import { NextRequest, NextResponse } from "next/server";
import { mutateAgendaOccurrence } from "@/lib/server/agenda/recurrence";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { eventId } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const occurrenceStartAt = typeof body.occurrenceStartAt === "string" ? body.occurrenceStartAt : "";
    const action = body.action === "cancel" || body.action === "modify" ? body.action : null;
    if (!occurrenceStartAt || !action) {
      return NextResponse.json({ error: "occurrenceStartAt y action (cancel|modify) son obligatorios." }, { status: 400 });
    }
    const result = await mutateAgendaOccurrence({
      admin: createAdminSupabase(),
      userId: user.id,
      eventId,
      occurrenceStartAt,
      action,
      input: body,
    });
    return NextResponse.json(result);
  } catch (error) {
    const typed = error as Error & { status?: number; code?: string };
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo modificar la ocurrencia.", ...(typed.code ? { code: typed.code } : {}) },
      { status: typed.status ?? (isAuthError(error) ? 401 : 500) },
    );
  }
}
