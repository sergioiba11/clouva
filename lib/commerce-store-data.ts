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

function metadataImageUrls(metadata: Record<string, unknown> | null) {
  const root = metadata && typeof metadata === "object" ? metadata : {};
  const productImages = root.product_images && typeof root.product_images === "object" && !Array.isArray(root.product_images)
    ? root.product_images as Record<string, unknown>
    : {};
  const rows = [
    ...(Array.isArray(productImages.generated_images) ? productImages.generated_images : []),
    ...(Array.isArray(productImages.source_photos) ? productImages.source_photos : []),
  ];
  return rows.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const url = (entry as Record<string, unknown>).url;
    return typeof url === "string" && url.trim() ? [url.trim()] : [];
  });
}

export function commerceProductImages(product: CommerceProduct) {
  const images: string[] = [];
  if (product.cover_url) images.push(product.cover_url);

  if (Array.isArray(product.gallery)) {
    for (const entry of product.gallery) {
      if (typeof entry === "string" && entry.trim()) images.push(entry.trim());
      if (entry && typeof entry === "object" && "url" in entry && typeof entry.url === "string" && entry.url.trim()) {
        images.push(entry.url.trim());
      }
    }
  }

  images.push(...metadataImageUrls(product.metadata));
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
