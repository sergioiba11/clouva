import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { startVipProfileGeneration } from "@/lib/server/vip-profile-generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Works for either subject -- playerId XOR studioId in the body, mirrors
// requireActiveVipEntitlement's own shape.
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { playerId?: string; studioId?: string; referenceImageUrls?: unknown };
    const result = await startVipProfileGeneration({
      admin: createAdminSupabase(),
      userId: user.id,
      playerId: body.playerId,
      studioId: body.studioId,
      referenceImageUrls: body.referenceImageUrls,
    });
    return NextResponse.json(result);
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo iniciar la generación.";
    return NextResponse.json({ error: message }, { status });
  }
}
