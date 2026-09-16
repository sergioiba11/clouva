import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";
import { createPublicSupabase } from "@/lib/server/public-supabase";
import { studioPublicHref } from "@/lib/public-studio-routes";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes = ["/", "/tienda", "/catalogo", "/carrito", "/checkout", "/lamatrix", "/lamatrix/estudios", "/players"];
  const supabase = createPublicSupabase();

  const { data: studios } = await supabase
    .from("studios")
    .select("id,slug")
    .eq("is_published", true)
    .eq("publication_status", "published")
    .in("studio_os_status", ["active", "grace", "legacy_active"]);

  const studioIds = (studios ?? []).map((studio) => studio.id);
  const { data: aliases } = studioIds.length
    ? await supabase
        .from("public_slug_aliases")
        .select("entity_id,alias")
        .eq("entity_type", "studio")
        .eq("is_primary", true)
        .in("entity_id", studioIds)
    : { data: [] as Array<{ entity_id: string; alias: string }> };

  const aliasByStudio = new Map((aliases ?? []).map((row) => [row.entity_id, row.alias]));
  const studioRoutes = (studios ?? []).map((studio) => studioPublicHref(aliasByStudio.get(studio.id) || studio.slug));
  const lastModified = new Date();

  return [...staticRoutes, ...studioRoutes].map((route) => ({
    url: `${siteUrl}${route}`,
    lastModified,
  }));
}
