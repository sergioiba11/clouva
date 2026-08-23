import { NextRequest, NextResponse } from "next/server";
import { SPOT_MODULES } from "@/lib/commerce/spot-business";
import { spotRoleAllows, spotRoleCapabilities } from "@/lib/commerce/spot-permissions";
import { requireSpotAccess } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODULE_SET = new Set<string>(SPOT_MODULES);

function short(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function stringArray(value: unknown, max = 16) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))).slice(0, max);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ spotId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spotId } = await params;
    const admin = createAdminSupabase();
    const access = await requireSpotAccess({ admin, userId: user.id, spotId, capability: "view" });

    const [productCount, orderCount, inventoryCount, memberCount] = await Promise.all([
      admin.from("commerce_products").select("id", { count: "exact", head: true }).eq("spot_id", spotId),
      admin.from("commerce_orders").select("id", { count: "exact", head: true }).eq("spot_id", spotId),
      admin.from("commerce_inventory_movements").select("id", { count: "exact", head: true }).eq("spot_id", spotId),
      admin.from("commerce_spot_members").select("id", { count: "exact", head: true }).eq("spot_id", spotId).eq("status", "active"),
    ]);
    for (const result of [productCount, orderCount, inventoryCount, memberCount]) {
      if (result.error) throw new Error(result.error.message);
    }

    let finance: Record<string, unknown> | null = null;
    if (spotRoleAllows(access.role, "finance")) {
      const summary = await admin.rpc("commerce_spot_financial_summary", { p_spot_id: spotId });
      if (summary.error) throw new Error(summary.error.message);
      finance = (summary.data ?? {}) as Record<string, unknown>;
    }

    return NextResponse.json({
      spot: access.spot,
      studio: access.studio,
      role: access.role,
      capabilities: spotRoleCapabilities(access.role),
      canOpenCommerce: spotRoleAllows(access.role, "operations"),
      counts: {
        products: productCount.count ?? 0,
        orders: orderCount.count ?? 0,
        inventoryMovements: inventoryCount.count ?? 0,
        members: memberCount.count ?? 0,
      },
      finance,
    });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo cargar el Spot." }, { status });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ spotId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spotId } = await params;
    const admin = createAdminSupabase();
    await requireSpotAccess({ admin, userId: user.id, spotId, capability: "settings" });
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
      businessType?: string;
      businessCategories?: string[];
      enabledModules?: string[];
      brandTone?: string;
      logoUrl?: string;
      coverUrl?: string;
      accentColor?: string;
      palette?: string[];
      publicEnabled?: boolean;
    };

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) {
      const name = short(body.name, 160);
      if (!name) return NextResponse.json({ error: "El nombre no puede quedar vacío." }, { status: 400 });
      patch.name = name;
    }
    if (body.description !== undefined) patch.description = short(body.description, 1600) || null;
    if (body.businessType !== undefined) patch.business_type = short(body.businessType, 80) || null;
    if (body.businessCategories !== undefined) patch.business_categories = stringArray(body.businessCategories, 10).map((item) => item.slice(0, 80));
    if (body.enabledModules !== undefined) {
      const modules = stringArray(body.enabledModules, SPOT_MODULES.length).filter((module) => MODULE_SET.has(module));
      if (!modules.includes("dashboard")) modules.unshift("dashboard");
      patch.enabled_modules = modules;
    }
    if (body.brandTone !== undefined) patch.brand_tone = short(body.brandTone, 220) || null;
    if (body.logoUrl !== undefined) patch.logo_url = short(body.logoUrl, 1200) || null;
    if (body.coverUrl !== undefined) patch.cover_url = short(body.coverUrl, 1200) || null;
    if (body.accentColor !== undefined) patch.accent_color = short(body.accentColor, 32) || null;
    if (body.palette !== undefined) patch.palette = stringArray(body.palette, 8).map((item) => item.slice(0, 32));
    if (typeof body.publicEnabled === "boolean") patch.public_enabled = body.publicEnabled;

    const { data, error } = await admin.from("commerce_spots").update(patch).eq("id", spotId).select("*").single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ spot: data });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar el Spot." }, { status });
  }
}
