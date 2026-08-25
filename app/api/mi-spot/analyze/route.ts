import { NextRequest, NextResponse } from "next/server";
import {
  analyzeSpotBusiness,
  SpotBusinessAnalysisError,
} from "@/lib/server/spot-business-analysis";
import { isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string;
      intent?: string;
      country?: string;
      website?: string;
      social?: string;
      images?: Array<{ dataUrl?: string; label?: string }>;
    };
    const result = await analyzeSpotBusiness({
      name: body.name,
      description: body.description ?? "",
      intent: body.intent,
      country: body.country,
      website: body.website,
      social: body.social,
      images: (body.images ?? []).map((image) => ({ dataUrl: image.dataUrl ?? "", label: image.label })),
    });
    return NextResponse.json({
      ...result,
      provider: "gemini",
      analyzedAt: new Date().toISOString(),
      advisoryOnly: true,
    });
  } catch (error) {
    const status = error instanceof SpotBusinessAnalysisError
      ? error.status
      : ((error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500));
    return NextResponse.json({
      error: error instanceof Error ? error.message : "No se pudo analizar el negocio.",
    }, { status });
  }
}
