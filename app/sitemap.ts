import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";
import { createPublicSupabase } from "@/lib/server/public-supabase";
import { studioPublicHref } from "@/lib/public-studio-routes";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes = ["/", "/tienda", "/catalogo", "/carrito", "/checkout", "/lamatrix", "/lamatrix/estudios", "/players"];
  const supabase = createPublicSupabase();
  const now = new Date();

  const [{ data: studios }, { data: players }] = await Promise.all([
    supabase
      .from("studios")
      .select("id,slug")
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

  const [{ data: studioAliases }, { data: playerAliases }] = await Promise.all([
    studioIds.length
      ? supabase
          .from("public_slug_aliases")
          .select("entity_id,alias")
          .eq("entity_type", "studio")
          .eq("is_primary", true)
          .in("entity_id", studioIds)
      : Promise.resolve({ data: [] as Array<{ entity_id: string; alias: string }> }),
    playerIds.length
      ? supabase
          .from("public_slug_aliases")
          .select("entity_id,alias")
          .eq("entity_type", "player")
          .eq("is_primary", true)
          .in("entity_id", playerIds)
      : Promise.resolve({ data: [] as Array<{ entity_id: string; alias: string }> }),
  ]);

  const aliasByStudio = new Map((studioAliases ?? []).map((row) => [row.entity_id, row.alias]));
  const aliasByPlayer = new Map((playerAliases ?? []).map((row) => [row.entity_id, row.alias]));

  const entries: MetadataRoute.Sitemap = [
    ...staticRoutes.map((route) => ({ url: `${siteUrl}${route}`, lastModified: now })),
    ...(studios ?? []).map((studio) => ({
      url: `${siteUrl}${studioPublicHref(aliasByStudio.get(studio.id) || studio.slug)}`,
      lastModified: now,
    })),
    ...(players ?? []).map((player) => ({
      url: `${siteUrl}/${aliasByPlayer.get(player.id) || player.slug}`,
      lastModified: player.updated_at ? new Date(player.updated_at) : now,
    })),
  ];

  return [...new Map(entries.map((entry) => [entry.url, entry])).values()];
}
