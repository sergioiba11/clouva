import type { SupabaseClient } from "@supabase/supabase-js";
import { studioPublicHref } from "@/lib/public-studio-routes";
import { createAdminSupabase } from "./supabase";

export type PublicStudioReferenceInput = {
  id: string;
  slug: string;
  name: string;
  share_title?: string | null;
  logo_url?: string | null;
};

export type PublicStudioReference = {
  id: string;
  internalSlug: string;
  publicAlias: string;
  name: string;
  publicName: string;
  logoUrl: string | null;
  href: string;
  aliases: string[];
  activeBrandVersionId: string | null;
};

type AliasRow = { entity_id: string; alias: string; is_primary: boolean };
type BrandAssetRow = { owner_id: string; active_version_id: string | null; status: string };
type BrandVersionRow = { id: string; status: string };

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function fallbackPublicStudioReference(studio: PublicStudioReferenceInput): PublicStudioReference {
  const publicAlias = studio.slug;
  return {
    id: studio.id,
    internalSlug: studio.slug,
    publicAlias,
    name: studio.name,
    publicName: clean(studio.share_title) ?? studio.name,
    logoUrl: clean(studio.logo_url),
    href: studioPublicHref(publicAlias),
    aliases: [studio.slug],
    activeBrandVersionId: null,
  };
}

export async function resolvePublicStudioReferences(
  supabase: SupabaseClient,
  studios: PublicStudioReferenceInput[],
): Promise<Map<string, PublicStudioReference>> {
  const uniqueStudios = Array.from(new Map(studios.map((studio) => [studio.id, studio])).values());
  if (!uniqueStudios.length) return new Map();

  const studioIds = uniqueStudios.map((studio) => studio.id);
  const [{ data: aliases, error: aliasError }, { data: brandAssets, error: brandError }] = await Promise.all([
    supabase
      .from("public_slug_aliases")
      .select("entity_id,alias,is_primary")
      .eq("entity_type", "studio")
      .in("entity_id", studioIds),
    createAdminSupabase()
      .from("brand_assets")
      .select("owner_id,active_version_id,status")
      .eq("owner_type", "studio")
      .in("owner_id", studioIds)
      .eq("status", "active"),
  ]);

  if (aliasError) throw new Error(aliasError.message);
  // Public profile resolution must not disappear just because Brand Engine is
  // temporarily unavailable. In that case we keep the published Studio logo.
  const safeBrandAssets = brandError ? [] : ((brandAssets ?? []) as BrandAssetRow[]);
  const activeVersionIds = Array.from(new Set(safeBrandAssets.map((row) => row.active_version_id).filter((id): id is string => Boolean(id))));

  let versions: BrandVersionRow[] = [];
  if (activeVersionIds.length) {
    const { data, error } = await createAdminSupabase()
      .from("brand_asset_versions")
      .select("id,status")
      .in("id", activeVersionIds)
      .eq("status", "published");
    if (!error) versions = (data ?? []) as BrandVersionRow[];
  }

  const publishedVersionIds = new Set(versions.map((version) => version.id));
  const aliasRows = (aliases ?? []) as AliasRow[];
  const aliasesByStudio = new Map<string, AliasRow[]>();
  for (const row of aliasRows) {
    const list = aliasesByStudio.get(row.entity_id) ?? [];
    list.push(row);
    aliasesByStudio.set(row.entity_id, list);
  }

  const brandByStudio = new Map<string, string>();
  for (const row of safeBrandAssets) {
    if (!row.active_version_id || !publishedVersionIds.has(row.active_version_id) || brandByStudio.has(row.owner_id)) continue;
    brandByStudio.set(row.owner_id, row.active_version_id);
  }

  const result = new Map<string, PublicStudioReference>();
  for (const studio of uniqueStudios) {
    const studioAliases = aliasesByStudio.get(studio.id) ?? [];
    const primaryAlias = studioAliases.find((row) => row.is_primary)?.alias || studio.slug;
    const activeBrandVersionId = brandByStudio.get(studio.id) ?? null;
    const officialLogo = activeBrandVersionId
      ? `/api/brand-assets/${encodeURIComponent(activeBrandVersionId)}/logo?surface=dark`
      : clean(studio.logo_url);
    const allAliases = Array.from(new Set([primaryAlias, studio.slug, ...studioAliases.map((row) => row.alias)].filter(Boolean)));

    result.set(studio.id, {
      id: studio.id,
      internalSlug: studio.slug,
      publicAlias: primaryAlias,
      name: studio.name,
      publicName: clean(studio.share_title) ?? studio.name,
      logoUrl: officialLogo,
      href: studioPublicHref(primaryAlias),
      aliases: allAliases,
      activeBrandVersionId,
    });
  }

  return result;
}
