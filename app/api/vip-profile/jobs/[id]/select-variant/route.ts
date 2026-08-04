import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireActiveVipEntitlement } from "@/lib/server/vip-profile-permissions";
import { sanitizeLayoutConfig } from "@/lib/server/layout-config";
import type { GeneratedAsset } from "@/lib/server/vip-profile-assets";
import type { ProfileCopy } from "@/lib/server/vip-profile-gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Elige una de las hasta 3 variantes generadas en modo adaptive_layout
// (job.layout_variants) y recién ahí crea la versión draft real -- las otras
// no persisten como versión aparte, quedan solo en el job. Mismo patrón de
// autorización que /versions/[id] (dueño/manager con VIP activo, admin
// también vale vía requireActiveVipEntitlement).
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
    const variants = (job.layout_variants as unknown as Array<{ layout: unknown; assets: GeneratedAsset[] }> | null) ?? [];
    const variantIndex = typeof body.variantIndex === "number" ? body.variantIndex : -1;
    const chosen = variants[variantIndex];
    if (!chosen) return NextResponse.json({ error: "Esa variante no existe." }, { status: 400 });

    const copy = job.generated_copy as unknown as ProfileCopy;
    const layoutConfig = sanitizeLayoutConfig(chosen.layout) ?? {};
    const cover = chosen.assets.find((a) => a.kind === "cover");
    const logo = chosen.assets.find((a) => a.kind === "logo");
    const subjectColumn = job.player_id ? "player_id" : "studio_id";
    const subjectId = (job.player_id || job.studio_id) as string;

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
        studio_id: job.studio_id,
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

    // Compare-and-swap: si otra request ya seleccionó una variante para este
    // job (doble click, dos pestañas), esta segunda inserción de versión ya
    // ocurrió -- eso crearía una versión de más, pero el update de abajo con
    // status="awaiting_variant_selection" en el where evita que el job quede
    // inconsistente; el caso de doble versión duplicada es una raza rara que
    // el usuario puede resolver archivando la sobrante desde el panel.
    const { error: jobUpdateError } = await admin
      .from("vip_profile_generation_jobs")
      .update({ status: "review_ready" })
      .eq("id", job.id)
      .eq("status", "awaiting_variant_selection");
    if (jobUpdateError) throw new Error(jobUpdateError.message);

    return NextResponse.json({ versionId: version.id });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    const message = error instanceof Error ? error.message : "No se pudo elegir la variante.";
    return NextResponse.json({ error: message }, { status });
  }
}
