import { NextRequest, NextResponse } from "next/server";
import { requirePlayerBasics } from "@/lib/server/player-basics";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeSearch(value: string | null) {
  return (value || "").trim().toLocaleLowerCase("es").slice(0, 80);
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const player = await requirePlayerBasics(admin, user.id);
    const q = normalizeSearch(request.nextUrl.searchParams.get("q"));

    const { data: spaces, error } = await admin
      .from("spaces")
      .select("id,slug,name,type,business_kind,category,subcategory,location_label,description,logo_url,cover_url,public_enabled,status,legacy_studio_id,legacy_commerce_spot_id")
      .eq("public_enabled", true)
      .eq("status", "active")
      .in("type", ["studio", "business", "spot", "club", "brand"])
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);

    const filtered = (spaces ?? []).filter((space) => {
      if (!q) return true;
      const haystack = [space.name, space.slug, space.category, space.subcategory, space.location_label, space.description]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("es");
      return haystack.includes(q);
    }).slice(0, 40);

    const ids = filtered.map((space) => space.id);
    const [memberships, requests] = await Promise.all([
      ids.length
        ? admin.from("space_members").select("space_id,role,status").eq("player_id", player.id).in("space_id", ids)
        : Promise.resolve({ data: [], error: null }),
      ids.length
        ? admin.from("space_management_requests").select("id,space_id,requested_role,status,created_at").eq("user_id", user.id).in("space_id", ids).eq("status", "pending")
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (memberships.error) throw new Error(memberships.error.message);
    if (requests.error) throw new Error(requests.error.message);

    const membershipBySpace = new Map((memberships.data ?? []).map((row) => [String(row.space_id), row]));
    const requestBySpace = new Map((requests.data ?? []).map((row) => [String(row.space_id), row]));

    return NextResponse.json({
      spaces: filtered.map((space) => ({
        ...space,
        membership: membershipBySpace.get(String(space.id)) ?? null,
        pendingRequest: requestBySpace.get(String(space.id)) ?? null,
      })),
    });
  } catch (error) {
    const typed = error as Error & { status?: number; code?: string };
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudieron buscar negocios y espacios.", ...(typed.code ? { code: typed.code } : {}) },
      { status: typed.status ?? (isAuthError(error) ? 401 : 500) },
    );
  }
}
