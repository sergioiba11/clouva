import { NextRequest, NextResponse } from "next/server";
import {
  createFacebookPublicationBatch,
  getFacebookPublisherOverview,
} from "@/lib/server/facebook-publisher";
import { requireSpotAccess } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ spotId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spotId } = await params;
    const admin = createAdminSupabase();
    const access = await requireSpotAccess({ admin, userId: user.id, spotId, capability: "content" });
    const overview = await getFacebookPublisherOverview(admin, user.id, spotId);
    return NextResponse.json({
      spot: { id: access.spot.id, name: access.spot.name, timezone: access.spot.timezone, currency: access.spot.currency },
      ...overview,
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo cargar el Publicador Facebook.",
    }, { status });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ spotId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spotId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      productIds?: string[];
      idempotencyKey?: string;
      scheduledAt?: string | null;
    };
    const idempotencyKey = String(body.idempotencyKey || "").trim().slice(0, 200);
    if (!idempotencyKey) {
      return NextResponse.json({ error: "Falta la clave de idempotencia del lote." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    await requireSpotAccess({ admin, userId: user.id, spotId, capability: "content" });
    const result = await createFacebookPublicationBatch(admin, {
      userId: user.id,
      spotId,
      productIds: Array.isArray(body.productIds) ? body.productIds.map(String) : [],
      idempotencyKey,
      scheduledAt: body.scheduledAt || null,
    });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 202 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo crear el lote.",
    }, { status });
  }
}
