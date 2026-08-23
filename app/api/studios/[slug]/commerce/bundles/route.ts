import { NextRequest, NextResponse } from "next/server";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      bundleListingId?: string;
      components?: Array<{ listingId?: string; variantId?: string | null; quantity?: number }>;
    };
    if (!body.bundleListingId || !Array.isArray(body.components)) {
      return NextResponse.json({ error: "Elegí el combo y sus componentes." }, { status: 400 });
    }
    const components = body.components.map((component) => ({
      listing_id: component.listingId,
      variant_id: component.variantId || null,
      quantity: Math.max(1, Math.trunc(Number(component.quantity) || 1)),
    }));
    if (components.some((component) => !component.listing_id)) {
      return NextResponse.json({ error: "Todos los componentes deben tener un producto." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const { data, error } = await admin.rpc("configure_commerce_listing_bundle", {
      p_spot_id: spot.id,
      p_bundle_listing_id: body.bundleListingId,
      p_components: components,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ bundle: data });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo configurar el combo." }, { status });
  }
}
