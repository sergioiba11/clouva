import { NextRequest, NextResponse } from "next/server";
import { disconnectYoutube } from "@/core/integrations/youtube/service";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    await disconnectYoutube(createAdminSupabase(), user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo desconectar YouTube.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}
