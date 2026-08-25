import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      listingId?: string;
      variantId?: string | null;
      locationId?: string;
      quantityDelta?: number;
      movementType?: string;
      unitCost?: number | null;
      reference?: string;
      note?: string;
      idempotencyKey?: string;
    };
    if (!body.listingId || !body.locationId || !Number.isInteger(body.quantityDelta) || body.quantityDelta === 0) {
      return NextResponse.json({ error: "Publicación, ubicación y cantidad son obligatorias." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const movementType = body.movementType || (Number(body.quantityDelta) > 0 ? "adjustment_in" : "adjustment_out");
    const { data, error } = await admin.rpc("adjust_commerce_spot_inventory", {
      p_spot_id: spot.id,
      p_listing_id: body.listingId,
      p_variant_id: body.variantId || null,
      p_location_id: body.locationId,
      p_quantity_delta: body.quantityDelta,
      p_movement_type: movementType,
      p_unit_cost: body.unitCost ?? null,
      p_currency: spot.currency,
      p_reference: body.reference || "manual",
      p_note: body.note || null,
      p_actor_id: user.id,
      p_idempotency_key: body.idempotencyKey || `inventory:${spot.id}:${randomUUID()}`,
      p_metadata: { source: "spot-admin" },
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ movement: data });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar el stock." }, { status });
  }
}
