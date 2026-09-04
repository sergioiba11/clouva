import { NextRequest, NextResponse } from "next/server";
import { getAgendaFinancialTimeline } from "@/lib/server/agenda/timeline";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const from = request.nextUrl.searchParams.get("from") || "";
    const to = request.nextUrl.searchParams.get("to") || "";
    if (!from || !to) return NextResponse.json({ error: "from y to son obligatorios." }, { status: 400 });
    const items = await getAgendaFinancialTimeline({
      admin: createAdminSupabase(),
      userId: user.id,
      from,
      to,
    });
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cargar la economía de Agenda." }, { status });
  }
}
