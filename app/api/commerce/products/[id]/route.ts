import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDITABLE_FIELDS = new Set([
  "name", "description", "price", "currency", "stock", "cover_url", "gallery",
  "digital_asset_url", "avatar_asset_id",
]);
// Owners can only move between these three -- pending_review/approved/
// rejected/sold_out/archived are moderation/system states, set elsewhere.
const OWNER_STATUSES = new Set(["draft", "published", "paused"]);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requireUser(request);
    const { id } = await params;
    const { data, error } = await supabase.from("commerce_products").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "El producto no existe." }, { status: 404 });
    return NextResponse.json({ product: data });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo cargar el producto.";
    return NextResponse.json({ error: message }, { status });
  }
}

// Same RLS-is-the-authorization-boundary approach as POST /api/commerce/products
// -- this runs on the caller's own session, commerce_products_write_owner_or_admin
// rejects anyone who isn't the Player/Estudio owner/manager or an admin.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase } = await requireUser(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const changes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (!EDITABLE_FIELDS.has(key)) continue;
      if (key === "price") {
        const price = Number(value);
        if (!Number.isFinite(price) || price < 0) return NextResponse.json({ error: "El precio no es válido." }, { status: 400 });
        changes.price = price;
      } else if (key === "stock") {
        changes.stock = value == null ? null : Math.max(0, Math.floor(Number(value) || 0));
      } else if (key === "gallery") {
        changes.gallery = Array.isArray(value) ? value.slice(0, 20) : [];
      } else if (typeof value === "string") {
        changes[key] = value.trim() || null;
      } else if (value === null) {
        changes[key] = null;
      }
    }

    if (typeof body.status === "string") {
      if (!OWNER_STATUSES.has(body.status)) {
        return NextResponse.json({ error: "Estado no permitido desde acá." }, { status: 400 });
      }
      if (body.status === "published") {
        const { data: current, error: currentError } = await supabase.from("commerce_products").select("name,price,product_type").eq("id", id).maybeSingle();
        if (currentError) throw new Error(currentError.message);
        const name = typeof changes.name === "string" ? changes.name : current?.name;
        const price = typeof changes.price === "number" ? changes.price : current?.price;
        if (!name || price == null) {
          return NextResponse.json({ error: "El producto necesita nombre y precio antes de publicarse." }, { status: 400 });
        }
      }
      changes.status = body.status;
    }

    if (Object.keys(changes).length === 0) return NextResponse.json({ error: "Nada para actualizar." }, { status: 400 });

    const { data, error } = await supabase.from("commerce_products").update(changes).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: "No encontramos ese producto o no tenés permiso." }, { status: 404 });
    return NextResponse.json({ product: data });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo actualizar el producto.";
    return NextResponse.json({ error: message }, { status });
  }
}
