import { requireUser } from "@/lib/server/supabase";

type AuthedSupabase = Awaited<ReturnType<typeof requireUser>>["supabase"];

export type CreatorProjectRow = {
  id: string;
  user_id: string;
  owner_type: "player" | "studio" | "user" | "clouva";
  player_id: string | null;
  studio_id: string | null;
  spot_id: string | null;
  name: string;
  collection_name: string | null;
  category: string | null;
  creative_mode: string;
  source_type: string | null;
  source_ref: string | null;
  design_system: Record<string, unknown>;
  commerce_product_id: string | null;
};

export type CreatorConceptRow = {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  product_template: string;
  role: "primary" | "secondary";
  position: number;
  status: string;
  creative_config: Record<string, unknown>;
  design_overrides: Record<string, unknown>;
  reference_assets: unknown[];
  generated_assets: unknown[];
  approved_assets: unknown[];
  commerce_draft: Record<string, unknown>;
  variants_draft: unknown[];
  listing_copy: Record<string, unknown>;
  clothing_item_id: string | null;
  creator_3d_asset_id: string | null;
};

export type VariantInput = {
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

export type PrepareConceptBody = {
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

const LISTING_KINDS = new Set(["standard", "resale", "owned_design", "avatar", "combo"]);

type AssetLike = string | { url?: unknown };

type NormalizedVariant = {
  id: string | null;
  sku: string | null;
  title: string | null;
  size: string | null;
  color: string | null;
  price_override: number | null;
  stock: number;
  active: boolean;
  metadata: Record<string, unknown>;
};

export function short(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function assetUrl(asset: AssetLike) {
  if (typeof asset === "string") return asset.trim();
  return short(asset?.url, 2000);
}

function approvedUrls(conceptAssets: unknown, bodyAssets: unknown) {
  const raw = Array.isArray(bodyAssets) ? bodyAssets : Array.isArray(conceptAssets) ? conceptAssets : [];
  return [...new Set(raw.map((asset) => assetUrl(asset as AssetLike)).filter(Boolean))].slice(0, 20);
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "producto";
}

function nullableNumber(value: unknown) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeVariant(input: VariantInput): NormalizedVariant {
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

function creatorScopedSku(productId: string, conceptId: string, row: NormalizedVariant) {
  if (!row.sku) return null;
  const metadataConceptId = typeof row.metadata.creator_concept_id === "string" ? row.metadata.creator_concept_id : null;
  if (metadataConceptId !== conceptId) return row.sku;
  const suffix = productId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
  if (!suffix || row.sku.toUpperCase().endsWith(`-${suffix}`)) return row.sku;
  const maxBase = Math.max(1, 120 - suffix.length - 1);
  return `${row.sku.slice(0, maxBase).replace(/-+$/g, "")}-${suffix}`;
}

function variantSignature(input: { title?: string | null; size?: string | null; color?: string | null }) {
  return [input.title || "", input.size || "", input.color || ""]
    .map((value) => value.trim().toLocaleLowerCase("es"))
    .join("|");
}

async function syncVariants(
  supabase: AuthedSupabase,
  productId: string,
  conceptId: string,
  variants: VariantInput[],
) {
  const { data: existing, error: existingError } = await supabase
    .from("commerce_product_variants")
    .select("id,sku,title,size,color")
    .eq("product_id", productId);
  if (existingError) throw new Error(existingError.message);

  const rows = variants
    .slice(0, 50)
    .map(normalizeVariant)
    .map((row) => ({ ...row, sku: creatorScopedSku(productId, conceptId, row) }));
  const retained = new Set<string>();
  const result: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const match = (existing ?? []).find((current) =>
      (row.id && current.id === row.id)
      || (row.sku && current.sku === row.sku)
      || variantSignature(current) === variantSignature(row),
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
      result.push(data as Record<string, unknown>);
    } else {
      const { data, error } = await supabase
        .from("commerce_product_variants")
        .insert({
          product_id: productId,
          sku: row.sku,
          title: row.title,
          size: row.size,
          color: row.color,
          price_override: row.price_override,
          stock: row.stock,
          active: row.active,
          metadata: row.metadata,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      retained.add(String(data.id));
      result.push(data as Record<string, unknown>);
    }
  }

  const toDelete = (existing ?? []).filter((row) => !retained.has(row.id)).map((row) => row.id);
  if (toDelete.length) {
    const { error } = await supabase
      .from("commerce_product_variants")
      .delete()
      .in("id", toDelete)
      .eq("product_id", productId);
    if (error) throw new Error(error.message);
  }
  return result;
}

export async function assertCreatorSellerAccess(
  supabase: AuthedSupabase,
  userId: string,
  input: { ownerType: string; playerId?: string | null; studioId?: string | null; spotId?: string | null },
) {
  if (input.ownerType === "clouva") {
    const admin = await supabase.from("profiles").select("id").eq("id", userId).eq("role", "admin").maybeSingle();
    if (admin.error) throw new Error(admin.error.message);
    if (!admin.data) throw new Error("Sólo un admin puede crear un proyecto de CLOUVA.");
  }

  if (input.ownerType === "player") {
    if (!input.playerId) throw new Error("Falta el Player vendedor.");
    const [owned, member] = await Promise.all([
      supabase.from("players").select("id").eq("id", input.playerId).eq("owner_user_id", userId).maybeSingle(),
      supabase.from("player_members").select("player_id").eq("player_id", input.playerId).eq("user_id", userId).eq("status", "active").in("role", ["owner", "manager", "editor"]).maybeSingle(),
    ]);
    if (owned.error) throw new Error(owned.error.message);
    if (member.error) throw new Error(member.error.message);
    if (!owned.data && !member.data) throw new Error("No tenés permiso para vender como ese Player.");
  }

  if (input.ownerType === "studio") {
    if (!input.studioId) throw new Error("Falta el Studio vendedor.");
    const [owned, member] = await Promise.all([
      supabase.from("studios").select("id").eq("id", input.studioId).eq("owner_id", userId).maybeSingle(),
      supabase.from("studio_members").select("studio_id").eq("studio_id", input.studioId).eq("profile_id", userId).eq("status", "active").in("role", ["owner", "admin", "manager", "editor"]).maybeSingle(),
    ]);
    if (owned.error) throw new Error(owned.error.message);
    if (member.error) throw new Error(member.error.message);
    if (!owned.data && !member.data) throw new Error("No tenés permiso para vender como ese Studio.");
  }

  if (input.spotId) {
    const [ownedSpot, memberSpot] = await Promise.all([
      supabase.from("commerce_spots").select("id").eq("id", input.spotId).or(`owner_user_id.eq.${userId},created_by.eq.${userId}`).maybeSingle(),
      supabase.from("commerce_spot_members").select("spot_id").eq("spot_id", input.spotId).eq("user_id", userId).eq("status", "active").in("role", ["owner", "admin", "manager", "catalog"]).maybeSingle(),
    ]);
    if (ownedSpot.error) throw new Error(ownedSpot.error.message);
    if (memberSpot.error) throw new Error(memberSpot.error.message);
    if (!ownedSpot.data && !memberSpot.data) throw new Error("No tenés permiso para usar ese Business / Spot.");
  }
}

export async function prepareCreatorConceptProduct(args: {
  supabase: AuthedSupabase;
  userId: string;
  project: CreatorProjectRow;
  concept: CreatorConceptRow;
  body: PrepareConceptBody;
}) {
  const { supabase, userId, project, concept, body } = args;

  let existingProduct: Record<string, unknown> | null = null;
  const byConcept = await supabase
    .from("commerce_products")
    .select("*")
    .eq("creator_concept_id", concept.id)
    .maybeSingle();
  if (byConcept.error) throw new Error(byConcept.error.message);
  if (byConcept.data) existingProduct = byConcept.data as Record<string, unknown>;

  if (!existingProduct && concept.role === "primary" && project.commerce_product_id) {
    const legacy = await supabase
      .from("commerce_products")
      .select("*")
      .eq("id", project.commerce_product_id)
      .maybeSingle();
    if (legacy.error) throw new Error(legacy.error.message);
    if (legacy.data) {
      const currentConcept = typeof legacy.data.creator_concept_id === "string" ? legacy.data.creator_concept_id : null;
      if (!currentConcept || currentConcept === concept.id) existingProduct = legacy.data as Record<string, unknown>;
    }
  }

  const name = short(body.name, 180) || short(concept.name, 180);
  if (!name) throw new Error("El producto necesita nombre.");
  const incomingPrice = nullableNumber(body.price);
  const price = incomingPrice ?? nullableNumber(existingProduct?.price);
  if (price == null || price < 0) throw new Error("Definí un precio válido antes de preparar el producto.");

  const variants = Array.isArray(body.variants)
    ? body.variants
    : Array.isArray(concept.variants_draft)
      ? concept.variants_draft as VariantInput[]
      : [];
  const variantStock = variants.length
    ? variants.reduce((sum, variant) => sum + Math.max(0, Math.floor(Number(variant.stock) || 0)), 0)
    : null;
  const incomingStock = nullableNumber(body.stock);
  const stock = incomingStock == null
    ? variantStock ?? (existingProduct?.stock == null ? null : Math.max(0, Math.floor(Number(existingProduct.stock) || 0)))
    : Math.max(0, Math.floor(incomingStock));

  const urls = approvedUrls(concept.approved_assets, body.approved_images);
  const requestedCover = short(body.cover_url, 2000);
  const coverUrl = requestedCover || urls[0] || (typeof existingProduct?.cover_url === "string" ? existingProduct.cover_url : null);
  const gallery = [...new Set([...(coverUrl ? [coverUrl] : []), ...urls])].slice(0, 20);

  const currentMetadata = asRecord(existingProduct?.metadata);
  const currentProductImages = asRecord(currentMetadata.product_images);
  const incomingMetadata = asRecord(body.metadata);
  const metadata = {
    ...currentMetadata,
    ...incomingMetadata,
    category: project.category || currentMetadata.category || "Merch",
    collection_name: project.collection_name,
    creator_project_id: project.id,
    creator_concept_id: concept.id,
    creator_lineage: {
      project_id: project.id,
      concept_id: concept.id,
      creative_mode: project.creative_mode,
      source_type: project.source_type,
      source_ref: project.source_ref,
      collection_name: project.collection_name,
      product_template: concept.product_template,
      design_overrides: concept.design_overrides,
    },
    product_images: {
      ...currentProductImages,
      publication_master: {
        cover_url: coverUrl,
        gallery,
        creator_project_id: project.id,
        creator_concept_id: concept.id,
        approved_at: new Date().toISOString(),
      },
    },
    three_d: {
      clothing_item_id: concept.clothing_item_id,
      creator_3d_asset_id: concept.creator_3d_asset_id,
    },
  };

  const description = short(body.description, 5000)
    || short(concept.creative_config.description, 5000)
    || (typeof existingProduct?.description === "string" ? existingProduct.description : null);
  const currency = short(body.currency, 3).toUpperCase()
    || (typeof existingProduct?.currency === "string" ? existingProduct.currency : "ARS");
  const listingKind = LISTING_KINDS.has(String(body.listing_kind))
    ? String(body.listing_kind)
    : typeof existingProduct?.listing_kind === "string"
      ? existingProduct.listing_kind
      : "owned_design";

  let product: Record<string, unknown>;
  if (existingProduct) {
    const productId = String(existingProduct.id);
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
        creator_project_id: project.id,
        creator_concept_id: concept.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", productId)
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
      owner_user_id: project.owner_type === "user" ? userId : null,
      spot_id: project.spot_id,
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
      creator_project_id: project.id,
      creator_concept_id: concept.id,
      status: "draft",
      created_by: userId,
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

      const concurrent = await supabase
        .from("commerce_products")
        .select("*")
        .eq("creator_concept_id", concept.id)
        .maybeSingle();
      if (concurrent.error) throw new Error(concurrent.error.message);
      if (concurrent.data) {
        created = concurrent.data as Record<string, unknown>;
        break;
      }
    }
    if (!created) throw new Error("No pudimos generar una URL disponible para este producto.");
    product = created;
  }

  const productId = String(product.id);
  const syncedVariants = await syncVariants(supabase, productId, concept.id, variants);
  const commerceDraft = {
    name,
    description,
    price,
    currency,
    stock,
    listing_kind: listingKind,
    cover_url: coverUrl,
  };

  const { data: savedConcept, error: conceptError } = await supabase
    .from("commerce_creator_product_concepts")
    .update({
      status: "commerce_ready",
      approved_assets: urls.map((url) => ({ url, status: "approved" })),
      commerce_draft: commerceDraft,
      variants_draft: syncedVariants,
      updated_at: new Date().toISOString(),
    })
    .eq("id", concept.id)
    .eq("project_id", project.id)
    .select("*")
    .single();
  if (conceptError) throw new Error(conceptError.message);

  if (concept.role === "primary" && !project.commerce_product_id) {
    const { error: legacyPointerError } = await supabase
      .from("commerce_creator_projects")
      .update({ commerce_product_id: productId, updated_at: new Date().toISOString() })
      .eq("id", project.id)
      .is("commerce_product_id", null);
    if (legacyPointerError) throw new Error(legacyPointerError.message);
  }

  return { product, variants: syncedVariants, concept: savedConcept };
}
