import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireActiveVipEntitlement } from "@/lib/server/vip-profile-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fase 9: "Descartar candidato" -- marca la versión como 'rejected', nunca
// la publica ni borra ningún registro (ledger de brand_generation_jobs y la
// propia fila de brand_asset_versions quedan intactos, solo cambia de
// estado). Requiere la migración 20260806130000_brand_engine_v2_reject_status.sql
// aplicada (agrega 'rejected' al check constraint) -- no aplicada todavía en
// esta tanda, ver plan.
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
    if (version.status === "published") return NextResponse.json({ error: "No se puede descartar una identidad ya publicada." }, { status: 409 });

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

    const { data: updated, error: updateError } = await admin
      .from("brand_asset_versions")
      .update({ status: "rejected" })
      .eq("id", id)
      .select("id,status")
      .single();
    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ version: updated });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo descartar el candidato.";
    return NextResponse.json({ error: message }, { status });
  }
}
