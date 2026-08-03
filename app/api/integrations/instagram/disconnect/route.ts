import { NextRequest, NextResponse } from "next/server";
import { requireStudioManager } from "@/lib/server/studio-permissions";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const studioId = request.nextUrl.searchParams.get("studioId")?.trim() || undefined;
    const admin = createAdminSupabase();

    let query = admin
      .from("social_connections")
      .select("id")
      .eq("provider", "instagram")
      .neq("status", "disconnected")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (studioId) {
      await requireStudioManager({ admin, userId: user.id, studioId });
      query = query.eq("studio_id", studioId);
    } else {
      query = query.eq("user_id", user.id).is("studio_id", null);
    }

    const { data: connection, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    if (!connection) return NextResponse.json({ disconnected: true });

    const { error: updateError } = await admin
      .from("social_connections")
      .update({
        status: "disconnected",
        access_token_ciphertext: null,
        token_iv: null,
        token_auth_tag: null,
        refresh_token_ciphertext: null,
        refresh_token_iv: null,
        refresh_token_auth_tag: null,
        expires_at: null,
        continuation_hash: null,
      })
      .eq("id", connection.id);
    if (updateError) throw new Error(updateError.message);

    await admin.from("admin_audit_log").insert({
      admin_user_id: user.id,
      action: "instagram.disconnect",
      entity_type: "social_connection",
      entity_id: connection.id,
      reason: "Desconexión solicitada por el propietario",
    });

    return NextResponse.json({ disconnected: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo desconectar Instagram.";
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: message }, { status });
  }
}
