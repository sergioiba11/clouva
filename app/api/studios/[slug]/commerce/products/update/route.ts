import { NextRequest, NextResponse } from "next/server";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpdateBody = {
  listingId?: unknown;
  name?: unknown;
  description?: unknown;
  price?: unknown;
  costAmount?: unknown;
  stock?: unknown;
  status?: unknown;
};

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function nullableText(value: unknown, max: number) {
  const valueText = text(value, max);
  return valueText || null;
}

function numberValue(value: unknown, field: string, { min = 0, nullable = false }: { min?: number; nullable?: boolean } = {}) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < min) throw new Error(`${field} no es válido.`);
  return parsed;
}

function stockValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error("El stock no es válido.");
  return parsed;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const body = (await request.json().catch(() => ({}))) as UpdateBody;
    const listingId = text(body.listingId, 80);
    if (!listingId) return NextResponse.json({ error: "Falta el producto a editar." }, { status: 400 });

    const name = text(body.name, 180);
    if (!name) return NextResponse.json({ error: "El producto necesita un nombre." }, { status: 400 });

    const status = body.status === "published" || body.status === "draft" ? body.status : "";
    if (!status) return NextResponse.json({ error: "El estado debe ser draft o published." }, { status: 400 });

    const price = numberValue(body.price, "El precio");
    const costAmount = numberValue(body.costAmount, "El costo", { nullable: true });
    const stock = stockValue(body.stock);

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const { data: listing, error: listingError } = await admin
      .from("commerce_products")
      .select("id,spot_id,catalog_product_id")
      .eq("id", listingId)
      .eq("spot_id", spot.id)
      .maybeSingle();
    if (listingError) throw new Error(listingError.message);
    if (!listing) return NextResponse.json({ error: "Ese producto no pertenece a este MI SPOT." }, { status: 404 });

    const updatedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await admin
      .from("commerce_products")
      .update({
        name,
        description: nullableText(body.description, 4000),
        price,
        cost_amount: costAmount,
        stock,
        status,
        updated_at: updatedAt,
      })
      .eq("id", listing.id)
      .eq("spot_id", spot.id)
      .select("id,name,description,price,cost_amount,currency,stock,status,cover_url,metadata,updated_at")
      .single();
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ ok: true, product: updated });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo editar el producto." }, { status });
  }
}
