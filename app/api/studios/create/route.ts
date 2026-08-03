import { NextRequest, NextResponse } from "next/server";
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
    };
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    if (!name) return NextResponse.json({ error: "El nombre del Estudio es obligatorio." }, { status: 400 });

    const admin = createAdminSupabase();
    const { data, error } = await admin.rpc("create_studio_os_draft", {
      p_user_id: user.id,
      p_name: name,
      p_slug: typeof body.slug === "string" ? body.slug : name,
      p_city: typeof body.city === "string" ? body.city.trim().slice(0, 120) || null : null,
      p_description: typeof body.description === "string" ? body.description.trim().slice(0, 4000) || null : null,
    });
    if (error) throw new Error(error.message);

    const studio = data as { id: string; slug: string; name: string; studioOsStatus: string };
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
      studio,
      studioOsRequired: true,
      checkoutAvailable: Boolean(product?.is_active && price),
      next: `/studios/${studio.slug}/studio-os`,
    }, { status: 201 });
  } catch (error) {
    const status = isAuthError(error) ? 401 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo crear el Estudio." }, { status });
  }
}
