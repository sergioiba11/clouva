import { NextRequest, NextResponse } from "next/server";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug } = await params;
    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId: slug });
    const { data, error } = await admin
      .from("commerce_product_import_batches")
      .select("id,status,total_images,detected_products,processed_products,failed_products,error,metadata,created_at,updated_at")
      .eq("spot_id", spot.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return NextResponse.json({ batches: data ?? [] });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudieron cargar los lotes." }, { status });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug } = await params;
    const body = (await request.json().catch(() => ({}))) as { imageCount?: unknown };
    const imageCount = Math.max(0, Math.min(80, Math.floor(Number(body.imageCount) || 0)));
    if (!imageCount) return NextResponse.json({ error: "Seleccioná al menos una imagen." }, { status: 400 });

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId: slug });
    const { data, error } = await admin
      .from("commerce_product_import_batches")
      .insert({
        spot_id: spot.id,
        created_by: user.id,
        status: "uploading",
        total_images: imageCount,
        metadata: { expected_images: imageCount },
      })
      .select("id,status,total_images,created_at")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ batch: data }, { status: 201 });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo crear el lote." }, { status });
  }
}
