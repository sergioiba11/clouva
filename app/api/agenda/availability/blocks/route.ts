import { NextRequest, NextResponse } from "next/server";
import { cancelAgendaBlock, createAgendaBlock } from "@/lib/server/agenda/blocks";
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
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const agendaId = typeof body.agendaId === "string" ? body.agendaId : "";
    const startAt = typeof body.startAt === "string" ? body.startAt : "";
    const endAt = typeof body.endAt === "string" ? body.endAt : "";
    if (!agendaId || !startAt || !endAt) return NextResponse.json({ error: "agendaId, startAt y endAt son obligatorios." }, { status: 400 });
    const block = await createAgendaBlock({
      admin: createAdminSupabase(),
      userId: user.id,
      agendaId,
      startAt,
      endAt,
      reason: typeof body.reason === "string" ? body.reason : null,
    });
    return NextResponse.json({ block }, { status: 201 });
  } catch (error) {
    return apiError(error, "No se pudo bloquear el horario.");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const agendaId = typeof body.agendaId === "string" ? body.agendaId : "";
    const blockId = typeof body.blockId === "string" ? body.blockId : "";
    if (!agendaId || !blockId) return NextResponse.json({ error: "agendaId y blockId son obligatorios." }, { status: 400 });
    const block = await cancelAgendaBlock({ admin: createAdminSupabase(), userId: user.id, agendaId, blockId });
    return NextResponse.json({ block });
  } catch (error) {
    return apiError(error, "No se pudo liberar el horario.");
  }
}
