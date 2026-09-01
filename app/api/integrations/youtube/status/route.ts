import { NextRequest, NextResponse } from "next/server";
import { getYoutubePublicConnection } from "@/core/integrations/youtube/service";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const connection = await getYoutubePublicConnection(createAdminSupabase(), user.id);
    return NextResponse.json({ connection });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo leer YouTube.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}
