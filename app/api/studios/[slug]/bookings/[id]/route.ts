import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MANAGER_STATUSES = new Set(["confirmed", "completed", "cancelled"]);

// Runs on the caller's own session -- bookings_update_manager_or_admin is
// the authorization boundary, same approach as commerce_products.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
  try {
    const { supabase } = await requireUser(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { status?: unknown };
    const status = String(body.status || "");
    if (!MANAGER_STATUSES.has(status)) {
      return NextResponse.json({ error: "Estado no permitido." }, { status: 400 });
    }

    const { data, error } = await supabase.from("bookings").update({ status }).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "No encontramos esa reserva o no tenés permiso." }, { status: 404 });
    return NextResponse.json({ booking: data });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo actualizar la reserva.";
    return NextResponse.json({ error: message }, { status });
  }
}
