import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await requireUser(request);
    const { data, error } = await supabase
      .from("notifications")
      .select("id,type,title,body,link,read_at,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    const unreadCount = (data ?? []).filter((row) => !row.read_at).length;
    return NextResponse.json({ notifications: data ?? [], unreadCount }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = isAuthError(error) ? 401 : 500;
    const message = error instanceof Error ? error.message : "No se pudieron cargar las notificaciones.";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, supabase } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { id?: string; all?: boolean };
    let query = supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id);
    query = body.all ? query.is("read_at", null) : query.eq("id", body.id ?? "");
    const { error } = await query;
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const status = isAuthError(error) ? 401 : 500;
    const message = error instanceof Error ? error.message : "No se pudo actualizar la notificación.";
    return NextResponse.json({ error: message }, { status });
  }
}
