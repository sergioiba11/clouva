import { NextRequest, NextResponse } from "next/server";
import { confirmFacebookPublicationJob } from "@/lib/server/facebook-publisher";
import { requireSpotAccess } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ spotId: string; jobId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spotId, jobId } = await params;
    const body = (await request.json().catch(() => ({}))) as { publishedUrl?: string | null };
    const admin = createAdminSupabase();
    await requireSpotAccess({ admin, userId: user.id, spotId, capability: "content" });
    const result = await confirmFacebookPublicationJob(admin, {
      userId: user.id,
      spotId,
      jobId,
      publishedUrl: body.publishedUrl || null,
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo confirmar la publicación.",
    }, { status });
  }
}
