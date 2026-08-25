import { NextRequest, NextResponse } from "next/server";
import { requireSpotAccess } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ spotId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spotId } = await params;
    const admin = createAdminSupabase();
    await requireSpotAccess({ admin, userId: user.id, spotId, capability: "content" });

    const { data, error } = await admin
      .from("commerce_products")
      .select("id,name,description,price,currency,status,cover_url,spot_id,owner_type,player_id,studio_id,updated_at")
      .eq("spot_id", spotId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);

    return NextResponse.json({ products: data ?? [] });
  } catch (error) {
    const typed = error as Error & { status?: number; code?: string };
    const status = typed.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudieron cargar los productos del espacio.",
      ...(typed.code ? { code: typed.code } : {}),
    }, { status });
  }
}
