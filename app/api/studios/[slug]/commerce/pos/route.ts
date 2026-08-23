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
      items?: Array<{ listingId?: string; variantId?: string | null; quantity?: number }>;
      paymentMethod?: string;
      customerName?: string;
      customerEmail?: string;
      buyerId?: string | null;
      fxRateId?: string;
      idempotencyKey?: string;
    };
    const items = (body.items ?? [])
      .filter((item) => item.listingId)
      .map((item) => ({ listing_id: item.listingId, variant_id: item.variantId || null, quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)) }));
    if (!items.length || !body.fxRateId) return NextResponse.json({ error: "La venta necesita productos y una cotización vigente." }, { status: 400 });

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const { data, error } = await admin.rpc("complete_commerce_pos_sale", {
      p_spot_id: spot.id,
      p_items: items,
      p_payment_method: body.paymentMethod || "cash",
      p_customer_name: body.customerName || null,
      p_customer_email: body.customerEmail || null,
      p_buyer_id: body.buyerId || null,
      p_fx_rate_id: body.fxRateId,
      p_actor_id: user.id,
      p_idempotency_key: body.idempotencyKey || `pos:${spot.id}:${randomUUID()}`,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ sale: data }, { status: 201 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo confirmar la venta." }, { status });
  }
}
