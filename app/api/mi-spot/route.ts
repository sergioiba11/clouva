import { NextRequest, NextResponse } from "next/server";
import {
  sanitizeSpotBusinessAnalysis,
  type SpotBusinessAnalysis,
} from "@/lib/commerce/spot-business";
import { isSpotRole, spotRoleCapabilities } from "@/lib/commerce/spot-permissions";
import { getSpaceAdminEligibility, requireSpaceAdminPlan } from "@/lib/server/space-access";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SPOT_SELECT = "id,studio_id,owner_type,owner_user_id,beneficiary_user_id,slug,name,country_code,currency,timezone,fx_source,public_enabled,status,business_type,business_categories,enabled_modules,brand_tone,description,logo_url,cover_url,accent_color,palette,ai_profile,settings,created_at,updated_at";
const SPACE_TYPES = new Set(["business", "spot", "club", "brand", "other"]);

type SpotRow = Record<string, unknown> & {
  id: string;
  studio_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function short(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function listAccessibleSpots(userId: string) {
  const admin = createAdminSupabase();
  const [ownedUser, memberships, ownedStudios, studioMemberships, eligibility] = await Promise.all([
    admin.from("commerce_spots").select(SPOT_SELECT).eq("owner_type", "user").eq("owner_user_id", userId).neq("status", "archived"),
    admin.from("commerce_spot_members").select("spot_id,role,status").eq("user_id", userId).eq("status", "active"),
    admin.from("studios").select("id,name,slug").eq("owner_id", userId),
    admin.from("studio_members").select("studio_id,role,status").eq("profile_id", userId).eq("status", "active"),
    getSpaceAdminEligibility({ admin, userId }),
  ]);
  for (const result of [ownedUser, memberships, ownedStudios, studioMemberships]) {
    if (result.error) throw new Error(result.error.message);
  }

  const memberSpotIds = Array.from(new Set((memberships.data ?? []).map((row) => String(row.spot_id))));
  const studioIds = Array.from(new Set([
    ...(ownedStudios.data ?? []).map((row) => String(row.id)),
    ...(studioMemberships.data ?? []).map((row) => String(row.studio_id)),
  ]));

  const [memberSpots, studioSpots] = await Promise.all([
    memberSpotIds.length
      ? admin.from("commerce_spots").select(SPOT_SELECT).in("id", memberSpotIds).neq("status", "archived")
      : Promise.resolve({ data: [] as SpotRow[], error: null }),
    studioIds.length
      ? admin.from("commerce_spots").select(SPOT_SELECT).eq("owner_type", "studio").in("studio_id", studioIds).neq("status", "archived")
      : Promise.resolve({ data: [] as SpotRow[], error: null }),
  ]);
  if (memberSpots.error) throw new Error(memberSpots.error.message);
  if (studioSpots.error) throw new Error(studioSpots.error.message);

  const map = new Map<string, SpotRow>();
  for (const spot of [...(ownedUser.data ?? []), ...(memberSpots.data ?? []), ...(studioSpots.data ?? [])] as SpotRow[]) {
    map.set(String(spot.id), spot);
  }

  const studioMap = new Map<string, { id: string; name: string; slug: string }>();
  const referencedStudioIds = Array.from(new Set(Array.from(map.values()).flatMap((spot) => spot.studio_id ? [String(spot.studio_id)] : [])));
  if (referencedStudioIds.length) {
    const studios = await admin.from("studios").select("id,name,slug").in("id", referencedStudioIds);
    if (studios.error) throw new Error(studios.error.message);
    for (const studio of studios.data ?? []) studioMap.set(String(studio.id), { id: String(studio.id), name: String(studio.name), slug: String(studio.slug) });
  }

  const spots = [];
  for (const spot of map.values()) {
    const roleResult = await admin.rpc("commerce_spot_role_for_user", { p_spot_id: spot.id, p_user_id: userId });
    if (roleResult.error) throw new Error(roleResult.error.message);
    if (!isSpotRole(roleResult.data)) continue;
    const roleCapabilities = spotRoleCapabilities(roleResult.data);
    spots.push({
      ...spot,
      role: roleResult.data,
      capabilities: eligibility.canAdministerSpaces ? roleCapabilities : roleCapabilities.filter((capability) => capability === "view"),
      requiresVipForAdministration: !eligibility.canAdministerSpaces,
      studio: spot.studio_id ? studioMap.get(String(spot.studio_id)) ?? null : null,
    });
  }

  return spots.sort((a, b) => String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? "")));
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    return NextResponse.json({ spots: await listAccessibleSpots(user.id) });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron cargar tus espacios." }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
      countryCode?: string;
      currency?: string;
      intent?: string;
      spaceType?: string;
      analysis?: SpotBusinessAnalysis | Record<string, unknown> | null;
    };
    const name = short(body.name, 160);
    const description = short(body.description, 1600);
    const spaceType = short(body.spaceType, 20).toLowerCase() || "business";
    if (!SPACE_TYPES.has(spaceType)) {
      return NextResponse.json({ error: "Tipo de espacio inválido.", code: "INVALID_SPACE_TYPE" }, { status: 400 });
    }
    if (!name) return NextResponse.json({ error: "Poné un nombre para tu espacio." }, { status: 400 });
    if (!description) return NextResponse.json({ error: "Contanos qué vendés, ofrecés o hacés en este espacio." }, { status: 400 });

    const analysis = body.analysis
      ? sanitizeSpotBusinessAnalysis(body.analysis)
      : sanitizeSpotBusinessAnalysis({
          businessType: "general_business",
          businessCategories: body.intent ? [body.intent] : [],
          suggestedModules: ["dashboard", "products", "catalog", "inventory", "scanner", "codes", "sales", "orders", "finance", "settings"],
          suggestedInventoryMode: "simple",
          suggestedDescription: description,
        });

    const countryCode = (short(body.countryCode, 2) || "AR").toUpperCase();
    const currency = (short(body.currency, 3) || (countryCode === "AR" ? "ARS" : "USD")).toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode) || !/^[A-Z]{3}$/.test(currency)) {
      return NextResponse.json({ error: "País o moneda inválidos." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    await requireSpaceAdminPlan({ admin, userId: user.id });

    const { data: spot, error } = await admin.rpc("create_user_commerce_spot", {
      p_owner_user_id: user.id,
      p_name: name,
      p_country_code: countryCode,
      p_currency: currency,
      p_business_type: analysis.businessType,
      p_business_categories: analysis.businessCategories,
      p_enabled_modules: analysis.suggestedModules,
      p_brand_tone: analysis.suggestedBrandTone || null,
      p_description: analysis.suggestedDescription || description,
      p_accent_color: null,
      p_palette: [],
      p_ai_profile: {
        source: body.analysis ? "gemini" : "manual",
        intent: short(body.intent, 120) || null,
        spaceType,
        analysis,
        confirmedByUser: true,
        confirmedAt: new Date().toISOString(),
      },
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ spot, spaceType, next: `/mi-spot/${spot.id}` }, { status: 201 });
  } catch (error) {
    const typed = error as Error & { status?: number; code?: string };
    const status = typed.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo crear tu espacio.",
      ...(typed.code ? { code: typed.code } : {}),
    }, { status });
  }
}
