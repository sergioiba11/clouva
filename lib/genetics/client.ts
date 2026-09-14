import { supabase } from "@/lib/supabase";
import { PINA_EXPRESS_DEMO } from "@/lib/genetics/demo-data";
import type { ScanHistoryItem, Strain } from "@/lib/genetics/types";

const STRAIN_SELECT = `
  id,slug,name,subtitle,description,strain_type,hero_image,profile,tags,aromas,is_featured,
  effects:strain_effects(relaxation,creativity,energy,happiness,focus),
  terpenes:strain_terpenes(id,terpene,description,aroma,relative_value,sort_order),
  flavors:strain_flavors(id,flavor,value,sort_order)
`;

function normalizeStrain(raw: Record<string, unknown>): Strain {
  const rawEffects = raw.effects;
  const effects = Array.isArray(rawEffects) ? rawEffects[0] ?? null : rawEffects ?? null;
  return {
    id: String(raw.id),
    slug: String(raw.slug),
    name: String(raw.name),
    subtitle: typeof raw.subtitle === "string" ? raw.subtitle : null,
    description: typeof raw.description === "string" ? raw.description : null,
    strain_type: typeof raw.strain_type === "string" ? raw.strain_type : null,
    hero_image: typeof raw.hero_image === "string" && raw.hero_image ? raw.hero_image : null,
    profile: typeof raw.profile === "string" ? raw.profile : null,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    aromas: Array.isArray(raw.aromas) ? raw.aromas.map(String) : [],
    is_featured: raw.is_featured === true,
    effects: effects && typeof effects === "object" ? effects as Strain["effects"] : null,
    terpenes: Array.isArray(raw.terpenes)
      ? [...raw.terpenes as Strain["terpenes"]].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      : [],
    flavors: Array.isArray(raw.flavors)
      ? [...raw.flavors as Strain["flavors"]].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      : [],
  };
}

export async function loadStrains(): Promise<Strain[]> {
  const { data, error } = await supabase
    .from("cannabis_strains")
    .select(STRAIN_SELECT)
    .eq("is_published", true)
    .order("is_featured", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(24);

  if (error || !data?.length) return [PINA_EXPRESS_DEMO];
  return data.map((item) => normalizeStrain(item as unknown as Record<string, unknown>));
}

export async function loadStrain(slug: string): Promise<Strain | null> {
  const { data, error } = await supabase
    .from("cannabis_strains")
    .select(STRAIN_SELECT)
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();

  if (error || !data) return slug === PINA_EXPRESS_DEMO.slug ? PINA_EXPRESS_DEMO : null;
  return normalizeStrain(data as unknown as Record<string, unknown>);
}

export async function loadFavoriteIds(userId: string) {
  const { data, error } = await supabase
    .from("user_strain_favorites")
    .select("strain_id")
    .eq("user_id", userId);
  if (error) throw error;
  return new Set((data ?? []).map((row) => String(row.strain_id)));
}

export async function setFavorite(userId: string, strainId: string, favorite: boolean) {
  if (strainId.startsWith("demo-")) return;
  if (favorite) {
    const { error } = await supabase
      .from("user_strain_favorites")
      .upsert({ user_id: userId, strain_id: strainId }, { onConflict: "user_id,strain_id" });
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from("user_strain_favorites")
    .delete()
    .eq("user_id", userId)
    .eq("strain_id", strainId);
  if (error) throw error;
}

export async function registerStrainView(userId: string, strainId: string) {
  if (strainId.startsWith("demo-")) return;
  await supabase
    .from("user_strain_views")
    .upsert(
      { user_id: userId, strain_id: strainId, viewed_at: new Date().toISOString() },
      { onConflict: "user_id,strain_id" },
    );
}

export async function loadProfileGenetics(userId: string) {
  const [favoritesResult, viewsResult, scansResult] = await Promise.all([
    supabase.from("user_strain_favorites").select("strain_id,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(12),
    supabase.from("user_strain_views").select("strain_id,viewed_at").eq("user_id", userId).order("viewed_at", { ascending: false }).limit(12),
    supabase.from("strain_scans").select("id,analysis,created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(8),
  ]);

  const favoriteIds = (favoritesResult.data ?? []).map((row) => String(row.strain_id));
  const recentIds = (viewsResult.data ?? []).map((row) => String(row.strain_id));
  const ids = Array.from(new Set([...favoriteIds, ...recentIds]));
  let strainsById = new Map<string, Strain>();

  if (ids.length) {
    const { data } = await supabase.from("cannabis_strains").select(STRAIN_SELECT).in("id", ids);
    strainsById = new Map((data ?? []).map((row) => {
      const strain = normalizeStrain(row as unknown as Record<string, unknown>);
      return [strain.id, strain];
    }));
  }

  return {
    favorites: favoriteIds.map((id) => strainsById.get(id)).filter(Boolean) as Strain[],
    recent: recentIds.map((id) => strainsById.get(id)).filter(Boolean) as Strain[],
    scans: (scansResult.data ?? []) as unknown as ScanHistoryItem[],
  };
}
