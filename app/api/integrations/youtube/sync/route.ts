import { NextRequest, NextResponse } from "next/server";
import { syncYoutubeWithBrowserToken } from "@/core/integrations/youtube/browser-token";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { accessToken?: string };
    const accessToken = body.accessToken?.trim();
    if (!accessToken) return NextResponse.json({ error: "Falta la autorización temporal de Google." }, { status: 400 });

    const result = await syncYoutubeWithBrowserToken({
      admin: createAdminSupabase(),
      userId: user.id,
      accessToken,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar YouTube.";
    const status = isAuthError(error) ? 401 : message === "youtube_connection_required" ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
