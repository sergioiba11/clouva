export type CommerceVariant = {
  id: string;
  product_id: string;
  sku: string | null;
  title: string | null;
  size: string | null;
  color: string | null;
  price_override: number | null;
  stock: number;
  active: boolean;
  metadata: Record<string, unknown> | null;
};

export type CommerceProduct = {
  id: string;
  owner_type: "player" | "studio" | "user" | "clouva";
  player_id?: string | null;
  studio_id?: string | null;
  owner_user_id?: string | null;
  spot_id?: string | null;
  catalog_product_id?: string | null;
  product_type: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  currency: string;
  stock: number | null;
  status: string;
  cover_url: string | null;
  gallery: unknown;
  metadata: Record<string, unknown> | null;
  created_at: string;
  commerce_product_variants?: CommerceVariant[];
};

export const commerceProductSelect = [
  "id",
  "owner_type",
  "player_id",
  "studio_id",
  "owner_user_id",
  "spot_id",
  "catalog_product_id",
  "product_type",
  "name",
  "slug",
  "description",
  "price",
  "currency",
  "stock",
  "status",
  "cover_url",
  "gallery",
  "metadata",
  "created_at",
  "commerce_product_variants(id,product_id,sku,title,size,color,price_override,stock,active,metadata)",
].join(",");

export function commerceProductCategory(product: CommerceProduct) {
  const value = product.metadata?.category;
  return typeof value === "string" && value.trim() ? value.trim() : "Merch";
}

function addImageValue(images: string[], value: unknown) {
  if (typeof value === "string" && value.trim()) {
    images.push(value.trim());
    return;
  }
  if (value && typeof value === "object" && !Array.isArray(value) && "url" in value) {
    const url = (value as { url?: unknown }).url;
    if (typeof url === "string" && url.trim()) images.push(url.trim());
  }
}

function publicationMasterImages(metadata: Record<string, unknown> | null) {
  if (!metadata || typeof metadata !== "object") return [];
  const productImages = metadata.product_images && typeof metadata.product_images === "object" && !Array.isArray(metadata.product_images)
    ? metadata.product_images as Record<string, unknown>
    : {};
  const master = productImages.publication_master && typeof productImages.publication_master === "object" && !Array.isArray(productImages.publication_master)
    ? productImages.publication_master as Record<string, unknown>
    : {};

  const images: string[] = [];
  addImageValue(images, master.cover_url);
  if (Array.isArray(master.gallery)) {
    for (const entry of master.gallery) addImageValue(images, entry);
  }
  return [...new Set(images)];
}

export function commerceProductImages(product: CommerceProduct) {
  const images: string[] = [];
  addImageValue(images, product.cover_url);

  if (Array.isArray(product.gallery)) {
    for (const entry of product.gallery) addImageValue(images, entry);
  }

  // Publication surfaces must never fall back to raw source_photos or to
  // unapproved generated_images. Those remain private workflow/lineage assets
  // inside product_images metadata. Only the explicit publication master may
  // supplement cover_url/gallery during migration or legacy compatibility.
  images.push(...publicationMasterImages(product.metadata));
  return [...new Set(images)];
}

export function availableCommerceVariants(product: CommerceProduct) {
  return (product.commerce_product_variants ?? [])
    .filter((variant) => variant.active)
    .sort((a, b) => {
      const aLabel = [a.size, a.color, a.title].filter(Boolean).join(" ");
      const bLabel = [b.size, b.color, b.title].filter(Boolean).join(" ");
      return aLabel.localeCompare(bLabel, "es");
    });
}

export function commerceVariantPrice(product: CommerceProduct, variant: CommerceVariant | null) {
  return variant?.price_override == null ? Number(product.price) : Number(variant.price_override);
}
