import { NextRequest, NextResponse } from "next/server";
import { isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LISTING_KINDS = new Set(["standard", "resale", "owned_design", "avatar", "combo"]);

type AssetLike = string | { url?: unknown; kind?: unknown; label?: unknown; storagePath?: unknown };
type VariantInput = {
  id?: unknown;
  sku?: unknown;
  title?: unknown;
  size?: unknown;
  color?: unknown;
  price_override?: unknown;
  stock?: unknown;
  active?: unknown;
  metadata?: unknown;
};

function short(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function assetUrl(asset: AssetLike) {
  if (typeof asset === "string") return asset.trim();
  return short(asset?.url, 2000);
}

function approvedUrls(projectAssets: unknown, bodyAssets: unknown) {
  const raw = Array.isArray(bodyAssets) ? bodyAssets : Array.isArray(projectAssets) ? projectAssets : [];
  return [...new Set(raw.map((asset) => assetUrl(asset as AssetLike)).filter(Boolean))].slice(0, 20);
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "producto";
}

function nullableNumber(value: unknown) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeVariant(input: VariantInput) {
  const stock = Math.max(0, Math.floor(Number(input.stock) || 0));
  const priceOverride = nullableNumber(input.price_override);
  return {
    id: short(input.id, 80) || null,
    sku: short(input.sku, 120) || null,
    title: short(input.title, 160) || null,
    size: short(input.size, 80) || null,
    color: short(input.color, 80) || null,
    price_override: priceOverride == null ? null : Math.max(0, priceOverride),
    stock,
    active: input.active !== false,
    metadata: asRecord(input.metadata),
  };
}

function variantSignature(input: { title?: string | null; size?: string | null; color?: string | null }) {
  return [input.title || "", input.size || "", input.color || ""].map((value) => value.trim().toLocaleLowerCase("es")).join("|");
}

async function syncVariants(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  productId: string,
  variants: VariantInput[],
) {
  const { data: existing, error: existingError } = await supabase
    .from("commerce_product_variants")
    .select("id,sku,title,size,color")
    .eq("product_id", productId);
  if (existingError) throw new Error(existingError.message);

  const rows = variants.slice(0, 50).map(normalizeVariant);
  const retained = new Set<string>();
  const result: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const match = (existing ?? []).find((current) =>
      (row.id && current.id === row.id)
      || (row.sku && current.sku === row.sku)
      || (!row.id && !row.sku && variantSignature(current) === variantSignature(row)),
    );
    if (match) {
      const { data, error } = await supabase
        .from("commerce_product_variants")
        .update({
          sku: row.sku,
          title: row.title,
          size: row.size,
          color: row.color,
          price_override: row.price_override,
          stock: row.stock,
          active: row.active,
          metadata: row.metadata,
          updated_at: new Date().toISOString(),
        })
        .eq("id", match.id)
        .eq("product_id", productId)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      retained.add(match.id);
      result.push(data);
    } else {
      const { data, error } = await supabase
        .from("commerce_product_variants")
        .insert({ product_id: productId, ...row, id: undefined })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      retained.add(data.id);
      result.push(data);
    }
  }

  const toDelete = (existing ?? []).filter((row) => !retained.has(row.id)).map((row) => row.id);
  if (toDelete.length) {
    const { error } = await supabase.from("commerce_product_variants").delete().in("id", toDelete).eq("product_id", productId);
    if (error) throw new Error(error.message);
  }
  return result;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, supabase } = await requireUser(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      description?: unknown;
      price?: unknown;
      currency?: unknown;
      stock?: unknown;
      cover_url?: unknown;
      approved_images?: unknown;
      listing_kind?: unknown;
      variants?: VariantInput[];
      metadata?: unknown;
    };

    const { data: project, error: projectError } = await supabase
      .from("commerce_creator_projects")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (projectError) throw new Error(projectError.message);
    if (!project) return NextResponse.json({ error: "El proyecto no existe." }, { status: 404 });

    const existingProductId = typeof project.commerce_product_id === "string" ? project.commerce_product_id : null;
    let existingProduct: Record<string, unknown> | null = null;
    if (existingProductId) {
      const current = await supabase.from("commerce_products").select("*").eq("id", existingProductId).maybeSingle();
      if (current.error) throw new Error(current.error.message);
      if (!current.data) return NextResponse.json({ error: "El producto vinculado ya no existe o no tenés permiso." }, { status: 409 });
      existingProduct = current.data as Record<string, unknown>;
    }

    const name = short(body.name, 180) || short(project.name, 180);
    if (!name) return NextResponse.json({ error: "El producto necesita nombre." }, { status: 400 });
    const incomingPrice = nullableNumber(body.price);
    const price = incomingPrice ?? nullableNumber(existingProduct?.price);
    if (price == null || price < 0) return NextResponse.json({ error: "Definí un precio válido antes de preparar el producto." }, { status: 400 });

    const variants = Array.isArray(body.variants) ? body.variants : Array.isArray(project.variants_draft) ? project.variants_draft as VariantInput[] : [];
    const variantStock = variants.length ? variants.reduce((sum, variant) => sum + Math.max(0, Math.floor(Number(variant.stock) || 0)), 0) : null;
    const incomingStock = nullableNumber(body.stock);
    const stock = incomingStock == null
      ? variantStock ?? (existingProduct?.stock == null ? null : Math.max(0, Math.floor(Number(existingProduct.stock) || 0)))
      : Math.max(0, Math.floor(incomingStock));

    const urls = approvedUrls(project.approved_assets, body.approved_images);
    const requestedCover = short(body.cover_url, 2000);
    const coverUrl = requestedCover || urls[0] || (typeof existingProduct?.cover_url === "string" ? existingProduct.cover_url : null);
    const gallery = [...new Set([...(coverUrl ? [coverUrl] : []), ...urls])].slice(0, 20);
    const currentMetadata = asRecord(existingProduct?.metadata);
    const currentProductImages = asRecord(currentMetadata.product_images);
    const incomingMetadata = asRecord(body.metadata);
    const threeD = {
      clothing_item_id: project.clothing_item_id ?? null,
      creator_3d_asset_id: project.creator_3d_asset_id ?? null,
    };
    const metadata = {
      ...currentMetadata,
      ...incomingMetadata,
      category: short(project.category, 120) || currentMetadata.category || "Merch",
      creator_project_id: project.id,
      creator_lineage: {
        project_id: project.id,
        creative_mode: project.creative_mode,
        source_type: project.source_type,
        source_ref: project.source_ref,
        collection_name: project.collection_name,
      },
      product_images: {
        ...currentProductImages,
        publication_master: {
          cover_url: coverUrl,
          gallery,
          creator_project_id: project.id,
          approved_at: new Date().toISOString(),
        },
      },
      three_d: threeD,
    };

    const description = short(body.description, 5000) || short(project.brief, 5000) || (typeof existingProduct?.description === "string" ? existingProduct.description : null);
    const currency = short(body.currency, 3).toUpperCase() || (typeof existingProduct?.currency === "string" ? existingProduct.currency : "ARS");
    const listingKind = LISTING_KINDS.has(String(body.listing_kind))
      ? String(body.listing_kind)
      : typeof existingProduct?.listing_kind === "string" ? existingProduct.listing_kind : "owned_design";

    let product: Record<string, unknown>;
    if (existingProductId) {
      const { data, error } = await supabase
        .from("commerce_products")
        .update({
          name,
          description,
          price,
          currency,
          stock,
          cover_url: coverUrl,
          gallery,
          metadata,
          listing_kind: listingKind,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingProductId)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      product = data as Record<string, unknown>;
    } else {
      const baseSlug = slugify(name);
      const insert = {
        owner_type: project.owner_type,
        player_id: project.owner_type === "player" ? project.player_id : null,
        studio_id: project.owner_type === "studio" ? project.studio_id : null,
        owner_user_id: project.owner_type === "user" ? user.id : null,
        spot_id: project.spot_id ?? null,
        product_type: "physical",
        listing_kind: listingKind,
        name,
        description,
        price,
        currency,
        stock,
        cover_url: coverUrl,
        gallery,
        metadata,
        status: "draft",
        created_by: user.id,
      };
      let created: Record<string, unknown> | null = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
        const result = await supabase.from("commerce_products").insert({ ...insert, slug }).select("*").single();
        if (!result.error) {
          created = result.data as Record<string, unknown>;
          break;
        }
        if (!/duplicate key|unique constraint/i.test(result.error.message)) throw new Error(result.error.message);
      }
      if (!created) throw new Error("No pudimos generar una URL disponible para este producto.");
      product = created;
    }

    const productId = String(product.id);
    const syncedVariants = await syncVariants(supabase, productId, variants);

    const { data: savedProject, error: saveError } = await supabase
      .from("commerce_creator_projects")
      .update({
        commerce_product_id: productId,
        status: "commerce_ready",
        approved_assets: urls.map((url) => ({ url, status: "approved" })),
        commerce_draft: { name, description, price, currency, stock, listing_kind: listingKind, cover_url: coverUrl },
        variants_draft: syncedVariants,
        updated_at: new Date().toISOString(),
      })
      .eq("id", project.id)
      .select("*")
      .single();
    if (saveError) throw new Error(saveError.message);

    return NextResponse.json({ project: savedProject, product, variants: syncedVariants });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo preparar el producto." }, { status });
  }
}
