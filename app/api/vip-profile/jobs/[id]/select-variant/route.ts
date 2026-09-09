import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireActiveVipEntitlement } from "@/lib/server/vip-profile-permissions";
import { enqueueVipProfileJobStep } from "@/lib/server/cloud-tasks";
import { sanitizeLayoutConfig } from "@/lib/server/layout-config";
import type { GeneratedAsset } from "@/lib/server/vip-profile-assets";
import type { ProfileCopy } from "@/lib/server/vip-profile-gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PendingVariant = {
  layout: unknown;
  assets: GeneratedAsset[];
  previewUrl?: string | null;
  selected?: boolean;
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();

    const { data: job, error: jobError } = await admin
      .from("vip_profile_generation_jobs")
      .select("id,player_id,studio_id,status,generated_copy,layout_variants,identity_brief")
      .eq("id", id)
      .maybeSingle();
    if (jobError) throw new Error(jobError.message);
    if (!job) return NextResponse.json({ error: "El job no existe." }, { status: 404 });
    if (job.status !== "awaiting_variant_selection") {
      return NextResponse.json({ error: "Este job no tiene variantes pendientes de elegir." }, { status: 409 });
    }

    await requireActiveVipEntitlement({
      admin,
      userId: user.id,
      playerId: (job.player_id as string | null) ?? undefined,
      studioId: (job.studio_id as string | null) ?? undefined,
    });

    const body = (await request.json().catch(() => ({}))) as { variantIndex?: number };
    const variants = (job.layout_variants as unknown as PendingVariant[] | null) ?? [];
    const variantIndex = typeof body.variantIndex === "number" ? body.variantIndex : -1;
    const chosen = variants[variantIndex];
    if (!chosen) return NextResponse.json({ error: "Esa variante no existe." }, { status: 400 });
    const layoutConfig = sanitizeLayoutConfig(chosen.layout);
    if (!layoutConfig) return NextResponse.json({ error: "La propuesta seleccionada no tiene un layout válido." }, { status: 400 });

    // Studio: selecting a cheap preview does NOT create the draft yet.
    // It records the chosen layout and sends the existing job back through
    // generating_assets, where Brand Engine + expensive final imagery run
    // exactly once for the selected direction.
    if (job.studio_id) {
      const selectedVariants = variants.map((variant, index) => ({ ...variant, selected: index === variantIndex }));
      const { data: claimed, error: updateError } = await admin
        .from("vip_profile_generation_jobs")
        .update({
          status: "generating_assets",
          generated_layout: layoutConfig,
          layout_variants: selectedVariants,
          completed_at: null,
          error_message: null,
          error_code: null,
        })
        .eq("id", job.id)
        .eq("status", "awaiting_variant_selection")
        .select("id")
        .maybeSingle();
      if (updateError) throw new Error(updateError.message);
      if (!claimed) return NextResponse.json({ error: "La propuesta ya fue seleccionada desde otra pestaña." }, { status: 409 });
      await enqueueVipProfileJobStep(job.id as string);
      return NextResponse.json({ selected: true, status: "generating_assets", variantIndex });
    }

    // Player keeps its established selection semantics. This iteration is
    // intentionally scoped to the public Studio web.
    const copy = job.generated_copy as unknown as ProfileCopy;
    const cover = chosen.assets.find((a) => a.kind === "cover");
    const logo = chosen.assets.find((a) => a.kind === "logo");
    const subjectColumn = "player_id";
    const subjectId = job.player_id as string;

    const { data: lastVersion, error: lastVersionError } = await admin
      .from("player_profile_versions")
      .select("version_number")
      .eq(subjectColumn, subjectId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastVersionError) throw new Error(lastVersionError.message);
    const nextVersion = ((lastVersion?.version_number as number | null) ?? 0) + 1;

    const { data: version, error: versionError } = await admin
      .from("player_profile_versions")
      .insert({
        player_id: job.player_id,
        studio_id: null,
        generation_job_id: job.id,
        version_number: nextVersion,
        status: "draft",
        profile_level: "vip",
        template_key: "vip_default",
        copy_config: copy,
        visual_config: { energy: copy.visual_energy, tone: copy.visual_tone, palette: copy.palette },
        asset_references: [
          ...(cover ? [{ kind: "cover", url: cover.url }] : []),
          ...(logo ? [{ kind: "logo", url: logo.url }] : []),
        ],
        layout_config: layoutConfig,
        source_snapshot: job.identity_brief,
      })
      .select("id")
      .single();
    if (versionError) throw new Error(versionError.message);

    const { error: jobUpdateError } = await admin
      .from("vip_profile_generation_jobs")
      .update({ status: "review_ready" })
      .eq("id", job.id)
      .eq("status", "awaiting_variant_selection");
    if (jobUpdateError) throw new Error(jobUpdateError.message);

    return NextResponse.json({ versionId: version.id, status: "review_ready" });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo elegir la variante.";
    return NextResponse.json({ error: message }, { status });
  }
}
