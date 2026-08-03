import { NextRequest, NextResponse } from "next/server";
import { requireStudioManager } from "@/lib/server/studio-permissions";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const studioId = request.nextUrl.searchParams.get("studioId")?.trim() || undefined;
    const admin = createAdminSupabase();

    let query = admin
      .from("social_connections")
      .select("id,provider,external_account_id,external_username,display_name,account_type,expires_at,scopes,status,connected_at,last_synced_at,metadata")
      .eq("provider", "instagram")
      .neq("status", "disconnected")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (studioId) {
      await requireStudioManager({ admin, userId: user.id, studioId });
      query = query.eq("studio_id", studioId);
    } else {
      // .is("studio_id", null) evita que esta consulta "personal" traiga por
      // error una conexión que este mismo usuario conectó en nombre de un
      // Estudio (ambas filas comparten user_id como registro de auditoría).
      query = query.eq("user_id", user.id).is("studio_id", null);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    return NextResponse.json({ connection: data ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo consultar Instagram.";
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: message }, { status });
  }
}
