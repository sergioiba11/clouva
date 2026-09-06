import { createAdminSupabase } from "./supabase";

export type PublicSpaceProduct = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number | string | null;
  currency: string | null;
  stock: number | null;
  cover_url: string | null;
  product_type: string | null;
};

export type PublicSpaceIdentity = {
  space: {
    id: string;
    type: string;
    slug: string;
    name: string;
    description: string | null;
    logo_url: string | null;
    cover_url: string | null;
    accent_color: string | null;
    palette: string[];
    business_kind: string | null;
    category: string | null;
    subcategory: string | null;
    location_label: string | null;
    legacy_commerce_spot_id: string | null;
  };
  spot: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    logo_url: string | null;
    cover_url: string | null;
    accent_color: string | null;
    palette: string[];
    business_type: string | null;
    business_categories: string[];
    brand_tone: string | null;
  } | null;
  products: PublicSpaceProduct[];
  canonicalAlias: string;
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function resolvePublicSpaceAlias(alias: string): Promise<PublicSpaceIdentity | null> {
  const normalized = alias.trim().toLowerCase();
  if (!normalized) return null;

  // This is server-only and uses explicit public/status filters. `spaces` RLS
  // also supports member reads, so the public resolver must not rely on viewer
  // membership or accidentally expose a private Space.
  const supabase = createAdminSupabase();
  const { data: rawSpace, error: spaceError } = await supabase
    .from("spaces")
    .select("id,type,slug,name,description,logo_url,cover_url,accent_color,palette,business_kind,category,subcategory,location_label,legacy_commerce_spot_id")
    .eq("slug", normalized)
    .eq("public_enabled", true)
    .eq("status", "active")
    .neq("type", "studio")
    .maybeSingle();

  if (spaceError) throw new Error(spaceError.message);
  if (!rawSpace) return null;

  const space = {
    ...rawSpace,
    palette: strings(rawSpace.palette),
  };

  let spot: PublicSpaceIdentity["spot"] = null;
  let products: PublicSpaceProduct[] = [];

  if (space.legacy_commerce_spot_id) {
    const { data: rawSpot, error: spotError } = await supabase
      .from("commerce_spots")
      .select("id,slug,name,description,logo_url,cover_url,accent_color,palette,business_type,business_categories,brand_tone")
      .eq("id", space.legacy_commerce_spot_id)
      .eq("public_enabled", true)
      .eq("status", "active")
      .maybeSingle();

    if (spotError) throw new Error(spotError.message);
    if (rawSpot) {
      spot = {
        ...rawSpot,
        palette: strings(rawSpot.palette),
        business_categories: strings(rawSpot.business_categories),
      };

      const { data: productRows, error: productError } = await supabase
        .from("commerce_products")
        .select("id,name,slug,description,price,currency,stock,cover_url,product_type")
        .eq("spot_id", rawSpot.id)
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(60);

      if (productError) throw new Error(productError.message);
      products = (productRows ?? []) as PublicSpaceProduct[];
    }
  }

  return {
    space: space as PublicSpaceIdentity["space"],
    spot,
    products,
    canonicalAlias: space.slug,
  };
}
