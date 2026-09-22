import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";
import { createPublicSupabase } from "@/lib/server/public-supabase";
import { studioPublicHref } from "@/lib/public-studio-routes";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes = [
    "/",
    "/sobre-clouva",
    "/clouva",
    "/vidadeflows",
    "/tienda",
    "/catalogo",
    "/carrito",
    "/checkout",
    "/lamatrix",
    "/lamatrix/estudios",
    "/players",
    "/iglu/estudio",
    "/iglu/grabaciones",
    "/iglu/producciones",
    "/iglu/artistas",
    "/iglu/sesiones",
    "/iglu/nosotros",
    "/iglu/contacto",
  ];
  const supabase = createPublicSupabase();

  const [{ data: studios }, { data: players }] = await Promise.all([
    supabase
      .from("studios")
      .select("id,slug,updated_at")
      .eq("is_published", true)
      .eq("publication_status", "published")
      .in("studio_os_status", ["active", "grace", "legacy_active"]),
    supabase
      .from("players")
      .select("id,slug,updated_at")
      .eq("is_published", true)
      .eq("publication_status", "published")
      .neq("privacy_status", "private"),
  ]);

  const studioIds = (studios ?? []).map((studio) => studio.id);
  const playerIds = (players ?? []).map((player) => player.id);
  const entityIds = [...studioIds, ...playerIds];
  const { data: aliases } = entityIds.length
    ? await supabase
        .from("public_slug_aliases")
        .select("entity_id,entity_type,alias")
        .eq("is_primary", true)
        .in("entity_id", entityIds)
    : { data: [] as Array<{ entity_id: string; entity_type: string; alias: string }> };

  const studioAliasById = new Map((aliases ?? []).filter((row) => row.entity_type === "studio").map((row) => [row.entity_id, row.alias]));
  const playerAliasById = new Map((aliases ?? []).filter((row) => row.entity_type === "player").map((row) => [row.entity_id, row.alias]));
  const now = new Date();

  const entries: MetadataRoute.Sitemap = [
    ...staticRoutes.map((route) => ({ url: `${siteUrl}${route}`, lastModified: now })),
    ...(studios ?? []).map((studio) => ({
      url: `${siteUrl}${studioPublicHref(studioAliasById.get(studio.id) || studio.slug)}`,
      lastModified: studio.updated_at ? new Date(studio.updated_at) : now,
    })),
    ...(players ?? []).map((player) => ({
      url: `${siteUrl}/${playerAliasById.get(player.id) || player.slug}`,
      lastModified: player.updated_at ? new Date(player.updated_at) : now,
    })),
  ];

  return Array.from(new Map(entries.map((entry) => [entry.url, entry])).values());
}
