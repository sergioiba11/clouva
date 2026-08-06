import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireActiveVipEntitlement } from "@/lib/server/vip-profile-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const V4_MODES = ["owned_identity_reconstruction", "clouva_generated_redesign", "standalone_creation"];

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const { data: version, error: versionError } = await admin.from("brand_asset_versions")
      .select("id,brand_asset_id,status,import_mode,clearance_status,ownership_attested,master_svg_url,primary_logo_url,validation_report")
      .eq("id", id).maybeSingle();
    if (versionError) throw new Error(versionError.message);
    if (!version) return NextResponse.json({ error: "La versión de marca no existe." }, { status: 404 });
    const { data: brandAsset, error: brandAssetError } = await admin.from("brand_assets").select("id,owner_type,owner_id").eq("id", version.brand_asset_id).maybeSingle();
    if (brandAssetError) throw new Error(brandAssetError.message);
    if (!brandAsset) return NextResponse.json({ error: "El brand_asset no existe." }, { status: 404 });
    await requireActiveVipEntitlement({ admin, userId: user.id, playerId: brandAsset.owner_type === "player" ? brandAsset.owner_id as string : undefined, studioId: brandAsset.owner_type === "studio" ? brandAsset.owner_id as string : undefined });

    const isV4 = typeof version.import_mode === "string" && V4_MODES.includes(version.import_mode);
    if (version.status === "rejected") return NextResponse.json({ error: "Una identidad descartada no puede publicarse." }, { status: 409 });
    if (version.import_mode === "owned_identity_reconstruction" && version.ownership_attested !== true) return NextResponse.json({ error: "Falta la declaración de titularidad o autorización." }, { status: 409 });
    if (isV4 && !version.master_svg_url) return NextResponse.json({ error: "Falta el SVG maestro profesional." }, { status: 409 });
    if (!version.primary_logo_url) return NextResponse.json({ error: "Falta la vista principal de la identidad." }, { status: 409 });
    if (version.import_mode === "owned_identity_reconstruction") {
      const validation = version.validation_report as { rasterSimilarity?: number; smallSizeLegible?: boolean } | null;
      if (!validation || (validation.rasterSimilarity ?? 0) < 0.68 || validation.smallSizeLegible !== true) return NextResponse.json({ error: "La reconstrucción todavía necesita ajustes antes de publicarse." }, { status: 422 });
    }
    if (isV4 && version.clearance_status !== "clear") {
      const blocked = typeof version.clearance_status === "string" && version.clearance_status.startsWith("blocked_");
      return NextResponse.json({ error: blocked ? "Esta identidad presenta un conflicto y no puede publicarse." : "La identidad todavía requiere revisión de originalidad y propiedad intelectual." }, { status: blocked ? 409 : 422 });
    }
    const { data: published, error: publishError } = await admin.rpc("publish_brand_asset_version", { p_version_id: id });
    if (publishError) throw new Error(publishError.message);
    return NextResponse.json({ version: published });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo publicar el logo." }, { status });
  }
}
