import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRODUCT_TYPES = new Set([
  "physical", "digital", "avatar_item", "asset_3d", "music", "beat", "ticket", "exclusive_content", "bundle",
]);
const OWNER_TYPES = new Set(["player", "studio", "user", "clouva"]);
const LISTING_KINDS = new Set(["standard", "resale", "owned_design", "avatar", "combo"]);

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "producto";
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

// All writes run on the CALLER's own RLS-scoped session. The database policy
// remains the source of truth for whether this user can sell as Player,
// Studio, personal user, CLOUVA or through a permitted Spot.
export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await requireUser(request);
    const ownerType = request.nextUrl.searchParams.get("owner_type");
    const ownerId = request.nextUrl.searchParams.get("owner_id");
    const spotId = request.nextUrl.searchParams.get("spot_id");

    let query = supabase.from("commerce_products").select("*").order("created_at", { ascending: false });
    if (spotId) query = query.eq("spot_id", spotId);
    else if (ownerType === "player" && ownerId) query = query.eq("owner_type", "player").eq("player_id", ownerId);
    else if (ownerType === "studio" && ownerId) query = query.eq("owner_type", "studio").eq("studio_id", ownerId);
    else if (ownerType === "user") query = query.eq("owner_type", "user").eq("owner_user_id", ownerId || user.id);
    else if (ownerType === "clouva") query = query.eq("owner_type", "clouva");
    else query = query.eq("created_by", user.id);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return NextResponse.json({ products: data ?? [] });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudieron cargar los productos.";
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      owner_type?: string;
      player_id?: string;
      studio_id?: string;
      spot_id?: string;
      product_type?: string;
      listing_kind?: string;
      name?: string;
      description?: string;
      price?: number;
      currency?: string;
      stock?: number | null;
      cover_url?: string;
      gallery?: unknown[];
      digital_asset_url?: string;
      avatar_asset_id?: string;
      metadata?: Record<string, unknown>;
    };

    if (!body.owner_type || !OWNER_TYPES.has(body.owner_type)) {
      return NextResponse.json({ error: "owner_type inválido." }, { status: 400 });
    }
    if (body.owner_type === "player" && !body.player_id) return NextResponse.json({ error: "Falta player_id." }, { status: 400 });
    if (body.owner_type === "studio" && !body.studio_id) return NextResponse.json({ error: "Falta studio_id." }, { status: 400 });
    if (!body.product_type || !PRODUCT_TYPES.has(body.product_type)) {
      return NextResponse.json({ error: "product_type inválido." }, { status: 400 });
    }
    const name = (body.name || "").trim();
    if (!name) return NextResponse.json({ error: "El nombre es obligatorio." }, { status: 400 });
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) return NextResponse.json({ error: "El precio no es válido." }, { status: 400 });

    const insert: Record<string, unknown> = {
      owner_type: body.owner_type,
      player_id: body.owner_type === "player" ? body.player_id : null,
      studio_id: body.owner_type === "studio" ? body.studio_id : null,
      owner_user_id: body.owner_type === "user" ? user.id : null,
      spot_id: body.spot_id || null,
      product_type: body.product_type,
      listing_kind: body.listing_kind && LISTING_KINDS.has(body.listing_kind) ? body.listing_kind : "standard",
      name,
      slug: slugify(name),
      description: body.description?.trim() || null,
      price,
      currency: body.currency?.trim().toUpperCase() || "ARS",
      stock: body.stock == null ? null : Math.max(0, Math.floor(Number(body.stock) || 0)),
      cover_url: body.cover_url?.trim() || null,
      gallery: Array.isArray(body.gallery) ? body.gallery.slice(0, 20) : [],
      digital_asset_url: body.digital_asset_url?.trim() || null,
      avatar_asset_id: body.avatar_asset_id || null,
      metadata: asRecord(body.metadata),
      status: "draft",
      created_by: user.id,
    };

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidateSlug = attempt === 0 ? insert.slug : `${insert.slug}-${attempt + 1}`;
      const { data, error } = await supabase
        .from("commerce_products")
        .insert({ ...insert, slug: candidateSlug })
        .select("*")
        .single();
      if (!error) return NextResponse.json({ product: data }, { status: 201 });
      if (!/duplicate key|unique constraint/i.test(error.message)) throw new Error(error.message);
    }
    throw new Error("No pudimos generar una URL disponible para este producto.");
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo crear el producto.";
    return NextResponse.json({ error: message }, { status });
  }
}
