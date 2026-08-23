import { NextRequest, NextResponse } from "next/server";
import { refreshBcraUsdRate } from "@/lib/server/commerce-fx";
import { requireManagedSpot } from "@/lib/server/commerce-spot";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const admin = createAdminSupabase();
    const { spot } = await requireManagedSpot({ admin, userId: user.id, studioId });

    const rate = await refreshBcraUsdRate({ admin, spot });
    return NextResponse.json({ rate });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 502);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar la cotización." }, { status });
  }
}
