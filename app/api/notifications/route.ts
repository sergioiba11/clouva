import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await requireUser(request);
    const { data, error } = await supabase.from("notifications").select("id,type,title,body,link,read_at,created_at,actor_player_id,metadata").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30);
    if (error) throw new Error(error.message);
    const actorIds = Array.from(new Set((data ?? []).map((row) => row.actor_player_id ? String(row.actor_player_id) : "").filter(Boolean)));
    const admin = createAdminSupabase();
    const { data: actors, error: actorError } = actorIds.length ? await admin.from("players").select("id,display_name,username,profile_image_url").in("id", actorIds) : { data: [], error: null };
    if (actorError) throw new Error(actorError.message);
    const actorById = new Map((actors ?? []).map((actor) => [String(actor.id), actor]));
    const notifications = (data ?? []).map((row) => {
      const actor = row.actor_player_id ? actorById.get(String(row.actor_player_id)) : null;
      return { ...row, actor: actor ? { playerId: String(actor.id), displayName: actor.display_name || actor.username || "Player", username: actor.username || null, avatar: actor.profile_image_url || null } : null };
    });
    const unreadCount = notifications.filter((row) => !row.read_at).length;
    return NextResponse.json({ notifications, unreadCount }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = isAuthError(error) ? 401 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron cargar las notificaciones." }, { status });
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
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar la notificación." }, { status });
  }
}
