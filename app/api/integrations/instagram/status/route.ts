import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const { data, error } = await createAdminSupabase()
      .from("social_connections")
      .select("id,provider,external_account_id,external_username,display_name,account_type,expires_at,scopes,status,connected_at,last_synced_at,metadata")
      .eq("user_id", user.id)
      .eq("provider", "instagram")
      .neq("status", "disconnected")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return NextResponse.json({ connection: data ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo consultar Instagram.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}
