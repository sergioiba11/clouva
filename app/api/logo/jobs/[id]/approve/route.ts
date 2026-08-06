import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireActiveVipEntitlement } from "@/lib/server/vip-profile-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Única puerta de entrada desde /logo para que un candidato en 'draft' se
// vuelva identidad oficial -- nunca pasa solo (resolveBrandAsset jamás
// publica). Reusa la misma función SQL que publish_player_profile_version
// llama cuando el usuario confirma "publicar también el logo" al publicar
// una página (p_publish_logo_too) -- una sola lógica de sincronización.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();

    const { data: version, error: versionError } = await admin
      .from("brand_asset_versions")
      .select("id,brand_asset_id,status")
      .eq("id", id)
      .maybeSingle();
    if (versionError) throw new Error(versionError.message);
    if (!version) return NextResponse.json({ error: "La versión de marca no existe." }, { status: 404 });

    const { data: brandAsset, error: brandAssetError } = await admin
      .from("brand_assets")
      .select("id,owner_type,owner_id")
      .eq("id", version.brand_asset_id)
      .maybeSingle();
    if (brandAssetError) throw new Error(brandAssetError.message);
    if (!brandAsset) return NextResponse.json({ error: "El brand_asset no existe." }, { status: 404 });

    await requireActiveVipEntitlement({
      admin,
      userId: user.id,
      playerId: brandAsset.owner_type === "player" ? (brandAsset.owner_id as string) : undefined,
      studioId: brandAsset.owner_type === "studio" ? (brandAsset.owner_id as string) : undefined,
    });

    const { data: published, error: publishError } = await admin.rpc("publish_brand_asset_version", { p_version_id: id });
    if (publishError) throw new Error(publishError.message);

    return NextResponse.json({ version: published });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo aprobar el logo.";
    return NextResponse.json({ error: message }, { status });
  }
}
