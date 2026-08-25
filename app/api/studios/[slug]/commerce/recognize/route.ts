import { NextRequest, NextResponse } from "next/server";
import type { CommerceIdentifierType } from "@/lib/commerce/identifiers";
import {
  CommerceProductRecognitionError,
  recognizeCommerceProduct,
} from "@/lib/server/commerce-product-recognition";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const IDENTIFIER_TYPES = new Set<CommerceIdentifierType>([
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "code_128",
  "clouva_barcode",
  "clouva_qr",
  "sku",
]);

function isIdentifierType(value: unknown): value is CommerceIdentifierType {
  return typeof value === "string" && IDENTIFIER_TYPES.has(value as CommerceIdentifierType);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      images?: Array<{ dataUrl?: string; label?: string }>;
      identifier?: string | null;
      identifierType?: unknown;
    };

    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });
    const suppliedIdentifier = body.identifier?.trim() && isIdentifierType(body.identifierType)
      ? { value: body.identifier.trim(), type: body.identifierType }
      : null;
    const result = await recognizeCommerceProduct({
      images: (body.images ?? []).map((image) => ({
        dataUrl: image.dataUrl ?? "",
        label: image.label,
      })),
      spotName: spot.name,
      suppliedIdentifier,
    });

    return NextResponse.json({
      recognition: result.recognition,
      provider: "gemini",
      model: result.model,
      analyzedAt: new Date().toISOString(),
      usage: result.usage,
    });
  } catch (error) {
    const status = error instanceof CommerceProductRecognitionError
      ? error.status
      : ((error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500));
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo reconocer el producto.",
    }, { status });
  }
}
