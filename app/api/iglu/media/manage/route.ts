import { NextRequest, NextResponse } from "next/server";
import { requireMediaAdmin } from "@/lib/server/media-auth";
import { isAuthError } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IGLU_SLUG = "el-iglu";

export async function GET(request: NextRequest) {
  try {
    const { admin } = await requireMediaAdmin(request);

    const { data: studio, error: studioError } = await admin
      .from("studios")
      .select("id")
      .eq("slug", IGLU_SLUG)
      .maybeSingle();

    if (studioError) throw new Error(studioError.message);
    if (!studio) {
      return NextResponse.json({ canManage: false, error: "No encontramos El Iglú." }, { status: 404 });
    }

    return NextResponse.json(
      { canManage: true, role: "admin" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json(
      {
        canManage: false,
        error: error instanceof Error ? error.message : "No se pudo verificar el acceso a Media.",
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
