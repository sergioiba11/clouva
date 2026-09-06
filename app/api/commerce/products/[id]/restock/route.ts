import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireSpotAccess } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function short(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { id: productId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      variantId?: string | null;
      quantity?: unknown;
      unitCost?: unknown;
      supplier?: string | null;
      purchaseDate?: string | null;
      note?: string | null;
      idempotencyKey?: string;
    };

    const quantity = Math.floor(Number(body.quantity) || 0);
    if (quantity <= 0) return NextResponse.json({ error: "La reposición necesita una cantidad mayor a cero." }, { status: 400 });
    const unitCostRaw = body.unitCost;
    const unitCost = unitCostRaw == null || unitCostRaw === "" ? null : Number(unitCostRaw);
    if (unitCost != null && (!Number.isFinite(unitCost) || unitCost < 0)) {
      return NextResponse.json({ error: "Costo unitario inválido." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { data: product, error: productError } = await admin
      .from("commerce_products")
      .select("id,spot_id,currency")
      .eq("id", productId)
      .maybeSingle();
    if (productError) throw new Error(productError.message);
    if (!product?.spot_id) return NextResponse.json({ error: "El producto no pertenece a un negocio comercial." }, { status: 404 });

    const { spot } = await requireSpotAccess({ admin, userId: user.id, spotId: product.spot_id, capability: "inventory" });
    const { data: location, error: locationError } = await admin
      .from("commerce_inventory_locations")
      .select("id")
      .eq("spot_id", spot.id)
      .eq("status", "active")
      .order("code", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (locationError) throw new Error(locationError.message);
    if (!location) return NextResponse.json({ error: "El negocio no tiene una ubicación de inventario activa." }, { status: 409 });

    if (body.variantId) {
      const { data: variant, error: variantError } = await admin
        .from("commerce_product_variants")
        .select("id")
        .eq("id", body.variantId)
        .eq("product_id", productId)
        .maybeSingle();
      if (variantError) throw new Error(variantError.message);
      if (!variant) return NextResponse.json({ error: "La variante no pertenece al producto." }, { status: 400 });
    }

    const supplier = short(body.supplier, 300);
    const purchaseDate = short(body.purchaseDate, 40);
    const note = short(body.note, 1000);
    const idempotencyKey = body.idempotencyKey?.trim() || `restock:${spot.id}:${productId}:${randomUUID()}`;
    const { data: movement, error: movementError } = await admin.rpc("adjust_commerce_spot_inventory", {
      p_spot_id: spot.id,
      p_listing_id: productId,
      p_variant_id: body.variantId || null,
      p_location_id: location.id,
      p_quantity_delta: quantity,
      p_movement_type: "purchase_receipt",
      p_unit_cost: unitCost,
      p_currency: spot.currency,
      p_reference: supplier || "reposición",
      p_note: note || null,
      p_actor_id: user.id,
      p_idempotency_key: idempotencyKey,
      p_metadata: {
        source: "restock",
        supplier: supplier || null,
        purchase_date: purchaseDate || null,
      },
    });
    if (movementError) throw new Error(movementError.message);

    if (unitCost != null) {
      const costUpdate = body.variantId
        ? await admin.from("commerce_product_variants").update({ cost_override: unitCost }).eq("id", body.variantId).eq("product_id", productId)
        : await admin.from("commerce_products").update({ cost_amount: unitCost, updated_at: new Date().toISOString() }).eq("id", productId);
      if (costUpdate.error) throw new Error(costUpdate.error.message);
    }

    return NextResponse.json({ movement }, { status: 201 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo registrar la reposición." }, { status });
  }
}
