import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRODUCT_TYPES = new Set([
  "physical", "digital", "avatar_item", "asset_3d", "music", "beat", "ticket", "exclusive_content", "bundle",
]);

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "producto";
}

// Insert/update run on the CALLER's own RLS-scoped session (from requireUser),
// not the admin client -- commerce_products_write_owner_or_admin is the
// single source of truth for "can this user sell as this Player/Estudio",
// same as every other owner-gated table in this schema. No parallel
// authorization logic to keep in sync with the policy.
export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requireUser(request);
    const ownerType = request.nextUrl.searchParams.get("owner_type");
    const ownerId = request.nextUrl.searchParams.get("owner_id");

    let query = supabase.from("commerce_products").select("*").order("created_at", { ascending: false });
    if (ownerType === "player" && ownerId) query = query.eq("owner_type", "player").eq("player_id", ownerId);
    else if (ownerType === "studio" && ownerId) query = query.eq("owner_type", "studio").eq("studio_id", ownerId);
    else query = query.eq("created_by", (await supabase.auth.getUser()).data.user?.id ?? "");

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
      product_type?: string;
      name?: string;
      description?: string;
      price?: number;
      currency?: string;
      stock?: number | null;
      cover_url?: string;
      digital_asset_url?: string;
      avatar_asset_id?: string;
    };

    if (body.owner_type !== "player" && body.owner_type !== "studio") {
      return NextResponse.json({ error: "owner_type debe ser player o studio." }, { status: 400 });
    }
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
      product_type: body.product_type,
      name,
      slug: slugify(name),
      description: body.description?.trim() || null,
      price,
      currency: body.currency?.trim() || "ARS",
      stock: body.stock == null ? null : Math.max(0, Math.floor(Number(body.stock) || 0)),
      cover_url: body.cover_url?.trim() || null,
      digital_asset_url: body.digital_asset_url?.trim() || null,
      avatar_asset_id: body.avatar_asset_id || null,
      status: "draft",
      created_by: user.id,
    };

    // Slug collisions within one seller's catalog just get a numeric suffix,
    // same pattern as availableSlug() in /api/players/me.
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
