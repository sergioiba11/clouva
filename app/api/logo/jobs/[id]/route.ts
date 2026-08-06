import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireActiveVipEntitlement } from "@/lib/server/vip-profile-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();

    const { data: job, error: jobError } = await admin
      .from("brand_generation_jobs")
      .select("id,owner_type,owner_id,status,source,detected_logo,candidates,result_brand_asset_version_id,actual_cost_usd,error_message,created_at,completed_at")
      .eq("id", id)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return NextResponse.json({ error: "El job no existe." }, { status: 404 });

    await requireActiveVipEntitlement({
      admin,
      userId: user.id,
      playerId: job.owner_type === "player" ? (job.owner_id as string) : undefined,
      studioId: job.owner_type === "studio" ? (job.owner_id as string) : undefined,
    });

    let version = null;
    if (job.result_brand_asset_version_id) {
      const { data, error } = await admin
        .from("brand_asset_versions")
        .select("id,status,primary_logo_url,symbol_logo_url,horizontal_logo_url,vertical_logo_url,square_logo_url,transparent_logo_url,white_logo_url,black_logo_url,favicon_url")
        .eq("id", job.result_brand_asset_version_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      version = data;
    }

    return NextResponse.json({ job, version });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo cargar el job.";
    return NextResponse.json({ error: message }, { status });
  }
}
