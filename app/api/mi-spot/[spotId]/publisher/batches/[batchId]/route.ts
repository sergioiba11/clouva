import { NextRequest, NextResponse } from "next/server";
import { getPublicationBatch, updatePublicationBatch } from "@/lib/server/facebook-publisher";
import { requireSpotAccess } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set(["pause", "resume", "cancel", "retry_failed"]);

export async function GET(request: NextRequest, { params }: { params: Promise<{ spotId: string; batchId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spotId, batchId } = await params;
    const admin = createAdminSupabase();
    await requireSpotAccess({ admin, userId: user.id, spotId, capability: "content" });
    return NextResponse.json(await getPublicationBatch(admin, user.id, spotId, batchId));
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cargar el lote." }, { status });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ spotId: string; batchId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spotId, batchId } = await params;
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    const action = String(body.action || "");
    if (!ACTIONS.has(action)) return NextResponse.json({ error: "Acción de lote inválida." }, { status: 400 });

    const admin = createAdminSupabase();
    await requireSpotAccess({ admin, userId: user.id, spotId, capability: "content" });
    const batch = await updatePublicationBatch(admin, {
      userId: user.id,
      spotId,
      batchId,
      action: action as "pause" | "resume" | "cancel" | "retry_failed",
    });
    return NextResponse.json({ batch });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar el lote." }, { status });
  }
}
