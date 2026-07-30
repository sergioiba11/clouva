import { NextRequest, NextResponse } from "next/server";
import { safeEqualHex } from "@/core/integrations/instagram/crypto";
import { createAdminSupabase } from "@/lib/server/supabase";
import { generateProfileCopy, type ProfileCopy } from "@/lib/server/vip-profile-gemini";
import type { IdentityBrief } from "@/lib/server/vip-profile-brief";
import { enqueueVipProfileJobStep } from "@/lib/server/cloud-tasks";
import { generateCoverAsset, type GeneratedAsset } from "@/lib/server/vip-profile-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called only by the Cloud Tasks queue (vip-profile-generation), never by a
// browser -- authenticated with a shared secret instead of a user session,
// same pattern as /api/internal/billing/reconcile. Each call advances the
// job exactly one status forward, self-enqueues the next step when there is
// one implemented, and returns. Implemented so far: queued -> preparing_identity
// -> generating_copy (Gemini text). generating_assets (Gemini images through
// the shared USD 40 ledger) is not implemented yet -- the job stops there.
function isAuthorized(request: NextRequest) {
  const provided = request.headers.get("x-clouva-vip-task-secret")?.trim() ?? "";
  const expected = process.env.VIP_PROFILE_TASK_SECRET?.trim() ?? "";
  if (!expected) return false;
  return safeEqualHex(provided, expected);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { jobId?: string };
  if (!body.jobId) return NextResponse.json({ error: "Falta jobId." }, { status: 400 });

  const admin = createAdminSupabase();
  const { data: job, error: jobError } = await admin
    .from("vip_profile_generation_jobs")
    .select("id,player_id,status,attempts,identity_brief,generated_copy,generated_assets,actual_cost_usd")
    .eq("id", body.jobId)
    .maybeSingle();
  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: "El job no existe." }, { status: 404 });

  try {
    switch (job.status) {
      case "queued": {
        const { error } = await admin
          .from("vip_profile_generation_jobs")
          .update({ status: "preparing_identity", started_at: new Date().toISOString(), attempts: (job.attempts as number) + 1 })
          .eq("id", job.id)
          .eq("status", "queued");
        if (error) throw new Error(error.message);
        await enqueueVipProfileJobStep(job.id as string);
        return NextResponse.json({ ok: true, status: "preparing_identity" });
      }
      case "preparing_identity": {
        // Combines analyzing_identity + generating_copy into one Gemini text
        // call (cheap, not gated by the image budget ledger -- see
        // lib/server/vip-profile-gemini.ts). Next step (generating_assets:
        // Gemini image generation through the shared USD 40 ledger) is not
        // implemented yet -- the job stays at generating_copy on purpose.
        const brief = job.identity_brief as unknown as IdentityBrief;
        const { copy, costUsd }: { copy: ProfileCopy; costUsd: number } = await generateProfileCopy(brief);
        const { error } = await admin
          .from("vip_profile_generation_jobs")
          .update({
            status: "generating_copy",
            generated_copy: copy,
            actual_cost_usd: Number((((job.actual_cost_usd as number | null) ?? 0) + costUsd).toFixed(6)),
          })
          .eq("id", job.id)
          .eq("status", "preparing_identity");
        if (error) throw new Error(error.message);
        await enqueueVipProfileJobStep(job.id as string);
        return NextResponse.json({ ok: true, status: "generating_copy", copy });
      }
      case "generating_copy": {
        const copy = job.generated_copy as unknown as ProfileCopy;
        const brief = job.identity_brief as unknown as IdentityBrief;
        const asset: GeneratedAsset = await generateCoverAsset({
          admin,
          playerId: job.player_id as string,
          copy,
          professionalCategories: brief.professional_categories ?? [],
        });
        const { error } = await admin
          .from("vip_profile_generation_jobs")
          .update({
            status: "assembling_profile",
            generated_assets: [asset],
            actual_cost_usd: Number((((job.actual_cost_usd as number | null) ?? 0) + asset.costUsd).toFixed(6)),
          })
          .eq("id", job.id)
          .eq("status", "generating_copy");
        if (error) throw new Error(error.message);
        await enqueueVipProfileJobStep(job.id as string);
        return NextResponse.json({ ok: true, status: "assembling_profile", asset });
      }
      case "assembling_profile": {
        const copy = job.generated_copy as unknown as ProfileCopy;
        const assets = (job.generated_assets as unknown as GeneratedAsset[] | null) ?? [];
        const cover = assets.find((a) => a.kind === "cover");

        const { data: lastVersion, error: lastVersionError } = await admin
          .from("player_profile_versions")
          .select("version_number")
          .eq("player_id", job.player_id)
          .order("version_number", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastVersionError) throw new Error(lastVersionError.message);
        const nextVersion = ((lastVersion?.version_number as number | null) ?? 0) + 1;

        const { data: version, error: versionError } = await admin
          .from("player_profile_versions")
          .insert({
            player_id: job.player_id,
            generation_job_id: job.id,
            version_number: nextVersion,
            status: "draft",
            profile_level: "vip",
            template_key: "vip_default",
            copy_config: copy,
            visual_config: { energy: copy.visual_energy, tone: copy.visual_tone },
            asset_references: cover ? [{ kind: "cover", url: cover.url }] : [],
            layout_config: {},
            source_snapshot: job.identity_brief,
          })
          .select("id")
          .single();
        if (versionError) throw new Error(versionError.message);

        const { error } = await admin
          .from("vip_profile_generation_jobs")
          .update({ status: "review_ready", completed_at: new Date().toISOString() })
          .eq("id", job.id)
          .eq("status", "assembling_profile");
        if (error) throw new Error(error.message);

        return NextResponse.json({ ok: true, status: "review_ready", versionId: version.id });
      }
      default:
        return NextResponse.json({ ok: true, status: job.status, note: "Sin paso siguiente implementado todavía." });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo procesar el paso.";
    await admin
      .from("vip_profile_generation_jobs")
      .update({ status: "failed", error_message: message })
      .eq("id", job.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
