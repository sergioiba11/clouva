import "server-only";

import type { SpotBusinessAnalysis, SpotModule } from "@/lib/commerce/spot-business";
import { requirePlayerBasics } from "@/lib/server/player-basics";
import { requireSpaceAdminPlan } from "@/lib/server/space-access";
import { createAdminSupabase } from "@/lib/server/supabase";

export type BusinessKind = "digital_business" | "physical_business" | "studio";

type AdminClient = ReturnType<typeof createAdminSupabase>;

const DIGITAL_MODULES: SpotModule[] = [
  "dashboard", "products", "catalog", "variants", "sales", "orders", "customers", "content", "finance", "settings",
];
const PHYSICAL_MODULES: SpotModule[] = [
  "dashboard", "products", "catalog", "variants", "inventory", "scanner", "barcode", "codes", "pos", "sales", "orders", "customers", "finance", "settings",
];
const STUDIO_MODULES = ["studio_os", "services", "bookings", "memberships", "commerce"];

export function defaultModulesForBusinessKind(kind: BusinessKind) {
  if (kind === "digital_business") return [...DIGITAL_MODULES];
  if (kind === "physical_business") return [...PHYSICAL_MODULES];
  return [...STUDIO_MODULES];
}

function short(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function uniq(values: string[], max = 24) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, max);
}

export async function createBusinessSpace({
  admin,
  userId,
  kind,
  name,
  slug,
  description,
  category,
  subcategory,
  location,
  countryCode = "AR",
  currency = "ARS",
  analysis = null,
}: {
  admin: AdminClient;
  userId: string;
  kind: BusinessKind;
  name: string;
  slug?: string | null;
  description?: string | null;
  category?: string | null;
  subcategory?: string | null;
  location?: string | null;
  countryCode?: string;
  currency?: string;
  analysis?: SpotBusinessAnalysis | null;
}) {
  const cleanName = short(name, 160);
  const cleanSlug = short(slug, 120);
  const cleanDescription = short(description, 4000);
  const cleanCategory = short(category, 120);
  const cleanSubcategory = short(subcategory, 120);
  const cleanLocation = short(location, 200);
  if (!cleanName) throw new Error("El nombre del negocio es obligatorio.");

  await requirePlayerBasics(admin, userId);
  await requireSpaceAdminPlan({ admin, userId });

  if (kind === "studio") {
    const { data, error } = await admin.rpc("create_studio_os_draft", {
      p_user_id: userId,
      p_name: cleanName,
      p_slug: cleanSlug || cleanName,
      p_city: cleanLocation || null,
      p_description: cleanDescription || null,
    });
    if (error) throw new Error(error.message);

    const studio = data as { id: string; slug: string; name: string; studioOsStatus: string };
    const { data: space, error: spaceError } = await admin
      .from("spaces")
      .update({
        business_kind: "studio",
        category: cleanCategory || null,
        subcategory: cleanSubcategory || null,
        location_label: cleanLocation || null,
        enabled_modules: STUDIO_MODULES,
        updated_at: new Date().toISOString(),
      })
      .eq("legacy_studio_id", studio.id)
      .select("id,slug,name,type,business_kind,legacy_studio_id,legacy_commerce_spot_id,enabled_modules")
      .single();
    if (spaceError) throw new Error(spaceError.message);

    return {
      kind,
      studio,
      spot: null,
      space,
      next: `/studios/${studio.slug}/studio-os`,
    };
  }

  const defaults = defaultModulesForBusinessKind(kind) as SpotModule[];
  const enabledModules = uniq([...(analysis?.suggestedModules ?? []), ...defaults]) as SpotModule[];
  const businessCategories = uniq([
    cleanCategory,
    cleanSubcategory,
    ...(analysis?.businessCategories ?? []),
  ], 10);
  const effectiveDescription = analysis?.suggestedDescription?.trim() || cleanDescription;
  const businessType = analysis?.businessType?.trim() || kind;

  const { data: spotData, error: spotError } = await admin.rpc("create_user_commerce_spot", {
    p_owner_user_id: userId,
    p_name: cleanName,
    p_country_code: countryCode.toUpperCase(),
    p_currency: currency.toUpperCase(),
    p_business_type: businessType,
    p_business_categories: businessCategories,
    p_enabled_modules: enabledModules,
    p_brand_tone: analysis?.suggestedBrandTone || null,
    p_description: effectiveDescription || cleanDescription || cleanName,
    p_accent_color: null,
    p_palette: [],
    p_ai_profile: {
      source: analysis ? "gemini" : "manual",
      businessKind: kind,
      analysis,
      confirmedByUser: true,
      confirmedAt: new Date().toISOString(),
    },
  });
  if (spotError) throw new Error(spotError.message);

  const spot = spotData as Record<string, unknown> & { id: string; settings?: Record<string, unknown> | null };
  const settings = {
    ...(spot.settings && typeof spot.settings === "object" ? spot.settings : {}),
    space_type: "business",
    business_kind: kind,
    category: cleanCategory || null,
    subcategory: cleanSubcategory || null,
    location_label: cleanLocation || null,
  };
  const { error: spotSettingsError } = await admin
    .from("commerce_spots")
    .update({ settings })
    .eq("id", spot.id);
  if (spotSettingsError) throw new Error(spotSettingsError.message);

  const { data: space, error: spaceError } = await admin
    .from("spaces")
    .update({
      type: "business",
      business_kind: kind,
      category: cleanCategory || null,
      subcategory: cleanSubcategory || null,
      location_label: cleanLocation || null,
      enabled_modules: enabledModules,
      updated_at: new Date().toISOString(),
    })
    .eq("legacy_commerce_spot_id", spot.id)
    .select("id,slug,name,type,business_kind,legacy_studio_id,legacy_commerce_spot_id,enabled_modules")
    .single();
  if (spaceError) throw new Error(spaceError.message);

  return {
    kind,
    studio: null,
    spot,
    space,
    next: `/mi-spot/${spot.id}`,
  };
}
