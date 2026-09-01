import { NextRequest, NextResponse } from "next/server";
import { syncYoutubeVideos } from "@/core/integrations/youtube/service";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const result = await syncYoutubeVideos(createAdminSupabase(), user.id);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar YouTube.";
    const status = isAuthError(error) ? 401 : message === "youtube_connection_required" || message === "youtube_reconnect_required" ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
