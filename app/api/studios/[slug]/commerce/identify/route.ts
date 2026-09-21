import { NextRequest, NextResponse } from "next/server";
import {
  CommerceProductRecognitionError,
  recognizeCommerceProduct,
} from "@/lib/server/commerce-product-recognition";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const body = (await request.json().catch(() => ({}))) as { image?: string };

    if (!body.image) {
      return NextResponse.json({ error: "Falta la imagen del objeto." }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const result = await recognizeCommerceProduct({
      images: [{ dataUrl: body.image, label: "Frente" }],
      spotName: spot.name,
    });

    return NextResponse.json({
      recognition: result.recognition,
      provider: result.provider,
      model: result.model,
      usage: result.usage,
      identifiedAt: new Date().toISOString(),
    });
  } catch (error) {
    const status = error instanceof CommerceProductRecognitionError
      ? error.status
      : ((error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500));

    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo identificar el objeto.",
    }, { status });
  }
}
