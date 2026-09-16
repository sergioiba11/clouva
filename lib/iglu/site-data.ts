import "server-only";
import { cache } from "react";
import { commerceProductSelect, type CommerceProduct } from "@/lib/commerce-store-data";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";
import { createPublicSupabase } from "@/lib/server/public-supabase";
import { resolveIgluAssets } from "./assets";

export const loadIgluSiteData = cache(async () => {
  const identity = await resolveStudioAlias("el-iglu").catch(() => null);
  if (!identity) return null;

  const supabase = createPublicSupabase();
  const [{ data: products }, assets] = await Promise.all([
    supabase
      .from("commerce_products")
      .select(commerceProductSelect)
      .eq("studio_id", identity.studio.id)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(12),
    resolveIgluAssets(),
  ]);

  return {
    ...identity,
    products: (products ?? []) as unknown as CommerceProduct[],
    assets: {
      ...assets,
      logo: assets.logo ?? identity.studio.logo_url ?? undefined,
      studioHero: assets.studioHero ?? identity.studio.cover_url ?? undefined,
      studioHeroAlt: assets.studioHeroAlt ?? identity.studio.cover_url ?? undefined,
    },
  };
});

export type IgluSiteData = NonNullable<Awaited<ReturnType<typeof loadIgluSiteData>>>;
