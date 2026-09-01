import { NextRequest, NextResponse } from "next/server";
import { createBusinessSpace } from "@/lib/server/business-spaces";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      slug?: unknown;
      city?: unknown;
      description?: unknown;
      category?: unknown;
      subcategory?: unknown;
    };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    if (!name) return NextResponse.json({ error: "El nombre del Estudio es obligatorio." }, { status: 400 });

    const admin = createAdminSupabase();
    const created = await createBusinessSpace({
      admin,
      userId: user.id,
      kind: "studio",
      name,
      slug: typeof body.slug === "string" ? body.slug : name,
      location: typeof body.city === "string" ? body.city : null,
      description: typeof body.description === "string" ? body.description : null,
      category: typeof body.category === "string" ? body.category : "Estudio",
      subcategory: typeof body.subcategory === "string" ? body.subcategory : null,
    });

    const { data: product, error: productError } = await admin
      .from("billing_products")
      .select("id,is_active")
      .eq("code", "clouva_studio_os")
      .maybeSingle();
    if (productError) throw new Error(productError.message);

    const { data: price, error: priceError } = product?.id
      ? await admin.from("billing_prices").select("id").eq("product_id", product.id).eq("is_active", true).limit(1).maybeSingle()
      : { data: null, error: null };
    if (priceError) throw new Error(priceError.message);

    return NextResponse.json({
      studio: created.studio,
      space: created.space,
      spaceType: "studio",
      businessKind: "studio",
      studioOsRequired: true,
      checkoutAvailable: Boolean(product?.is_active && price),
      next: created.next,
    }, { status: 201 });
  } catch (error) {
    const typed = error as Error & { status?: number; code?: string };
    const status = typed.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo crear el Estudio.",
      ...(typed.code ? { code: typed.code } : {}),
    }, { status });
  }
}
