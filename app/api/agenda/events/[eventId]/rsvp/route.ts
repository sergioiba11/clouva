import { NextRequest, NextResponse } from "next/server";
import { respondEventInvitation, type AgendaRsvp } from "@/lib/server/agenda";
import { canonicalEventId } from "@/lib/server/agenda/recurrence";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const paramsValue = await params;
    const eventId = canonicalEventId(paramsValue.eventId);
    const body = (await request.json().catch(() => ({}))) as { rsvpStatus?: AgendaRsvp };
    if (!body.rsvpStatus || !["pending", "accepted", "declined", "maybe"].includes(body.rsvpStatus)) {
      return NextResponse.json({ error: "RSVP inválido." }, { status: 400 });
    }
    const result = await respondEventInvitation({
      admin: createAdminSupabase(),
      userId: user.id,
      eventId,
      rsvpStatus: body.rsvpStatus,
    });
    return NextResponse.json(result);
  } catch (error) {
    const typed = error as Error & { status?: number; code?: string };
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo responder la invitación.", ...(typed.code ? { code: typed.code } : {}) },
      { status: typed.status ?? (isAuthError(error) ? 401 : 500) },
    );
  }
}
