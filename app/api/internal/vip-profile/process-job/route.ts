import { NextRequest, NextResponse } from "next/server";
import { safeEqualHex } from "@/core/integrations/instagram/crypto";
import { createAdminSupabase } from "@/lib/server/supabase";
import { generateProfileCopy, type ProfileCopy } from "@/lib/server/vip-profile-gemini";
import { playerBriefToFacts, studioBriefToFacts, type IdentityBrief, type StudioIdentityBrief } from "@/lib/server/vip-profile-brief";
import { enqueueVipProfileJobStep } from "@/lib/server/cloud-tasks";
import { fetchReferenceImages, generateCoverAsset, generateLogoAsset, type GeneratedAsset } from "@/lib/server/vip-profile-assets";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called only by the Cloud Tasks queue (vip-profile-generation), never by a
// browser -- authenticated with a shared secret instead of a user session,
// same pattern as /api/internal/billing/reconcile. Cloud Tasks guarantees
// at-least-once delivery (and this project's own auto-enqueue can also
// legitimately overlap with a manual retry), so every step that costs real
// Gemini money claims its work via a compare-and-swap status update FIRST
// (checked with .select().maybeSingle() -- not just .eq() on write) and
// bails out with no side effects if another invocation already claimed it.
// Works for either subject -- job.player_id XOR job.studio_id, same state
// machine either way: queued -> preparing_identity -> analyzing_identity
// (Gemini text) -> generating_copy -> generating_assets (Gemini image) ->
// assembling_profile -> review_ready.
function isAuthorized(request: NextRequest) {
  const provided = request.headers.get("x-clouva-vip-task-secret")?.trim() ?? "";
  const expected = process.env.VIP_PROFILE_TASK_SECRET?.trim() ?? "";
  if (!expected) return false;
  return safeEqualHex(provided, expected);
}

// Returns the claimed row, or null if another invocation already claimed it
// (status no longer matched `from` by the time this update ran).
async function claim(admin: SupabaseClient, jobId: string, from: string, to: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await admin
    .from("vip_profile_generation_jobs")
    .update({ status: to, ...extra })
    .eq("id", jobId)
    .eq("status", from)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
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
    .select("id,player_id,studio_id,status,attempts,identity_brief,generated_copy,generated_assets,actual_cost_usd,reference_image_urls")
    .eq("id", body.jobId)
    .maybeSingle();
  if (jobError) return NextResponse.json({ error: jobError.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: "El job no existe." }, { status: 404 });

  const isPlayer = Boolean(job.player_id);
  const subjectColumn = isPlayer ? "player_id" : "studio_id";
  const subjectId = (job.player_id || job.studio_id) as string;
  const entityPathPrefix = isPlayer ? `players/${subjectId}` : `studios/${subjectId}`;

  try {
    switch (job.status) {
      case "queued": {
        const claimed = await claim(admin, job.id as string, "queued", "preparing_identity", {
          started_at: new Date().toISOString(),
          attempts: (job.attempts as number) + 1,
        });
        if (!claimed) return NextResponse.json({ ok: true, status: job.status, note: "Ya reclamado por otra ejecución." });
        await enqueueVipProfileJobStep(job.id as string);
        return NextResponse.json({ ok: true, status: "preparing_identity" });
      }
      case "preparing_identity": {
        // No Gemini call here -- the brief is already built and stored by
        // /api/vip-profile/generate. This step just claims the next stage.
        const claimed = await claim(admin, job.id as string, "preparing_identity", "analyzing_identity");
        if (!claimed) return NextResponse.json({ ok: true, status: job.status, note: "Ya reclamado por otra ejecución." });
        await enqueueVipProfileJobStep(job.id as string);
        return NextResponse.json({ ok: true, status: "analyzing_identity" });
      }
      case "analyzing_identity": {
        // Combines analysis + copy into one Gemini text call (cheap, not
        // gated by the image budget ledger -- see vip-profile-gemini.ts).
        const facts = isPlayer
          ? playerBriefToFacts(job.identity_brief as unknown as IdentityBrief)
          : studioBriefToFacts(job.identity_brief as unknown as StudioIdentityBrief);
        const { copy, costUsd }: { copy: ProfileCopy; costUsd: number } = await generateProfileCopy({
          facts,
          subjectLabel: isPlayer ? "Player" : "Estudio",
        });
        const { error } = await admin
          .from("vip_profile_generation_jobs")
          .update({
            status: "generating_copy",
            generated_copy: copy,
            actual_cost_usd: Number((((job.actual_cost_usd as number | null) ?? 0) + costUsd).toFixed(6)),
          })
          .eq("id", job.id)
          .eq("status", "analyzing_identity");
        if (error) throw new Error(error.message);
        await enqueueVipProfileJobStep(job.id as string);
        return NextResponse.json({ ok: true, status: "generating_copy", copy });
      }
      case "generating_copy": {
        // No Gemini call here -- just claims the image-generation stage.
        const claimed = await claim(admin, job.id as string, "generating_copy", "generating_assets");
        if (!claimed) return NextResponse.json({ ok: true, status: job.status, note: "Ya reclamado por otra ejecución." });
        await enqueueVipProfileJobStep(job.id as string);
        return NextResponse.json({ ok: true, status: "generating_assets" });
      }
      case "generating_assets": {
        // Cover + logo are independent Gemini image calls, each with its own
        // budget reservation -- run them together and keep whatever succeeds
        // even if the other fails, so a transient failure on one doesn't
        // throw away money already spent (and billed by Google) on the other.
        const copy = job.generated_copy as unknown as ProfileCopy;
        const professionalCategories = isPlayer
          ? (job.identity_brief as unknown as IdentityBrief).professional_categories ?? []
          : (job.identity_brief as unknown as StudioIdentityBrief).services.map((s) => s.name);
        const referenceImageUrls = (job.reference_image_urls as string[] | null) ?? [];
        const referenceImages = referenceImageUrls.length ? await fetchReferenceImages(referenceImageUrls) : undefined;
        const results = await Promise.allSettled([
          generateCoverAsset({ admin, entityPathPrefix, copy, professionalCategories, referenceImages }),
          generateLogoAsset({ admin, entityPathPrefix, copy, professionalCategories, referenceImages }),
        ]);
        const assets = results
          .filter((result): result is PromiseFulfilledResult<GeneratedAsset> => result.status === "fulfilled")
          .map((result) => result.value);
        const costUsd = assets.reduce((sum, asset) => sum + asset.costUsd, 0);
        const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");

        const { error: saveError } = await admin
          .from("vip_profile_generation_jobs")
          .update({
            ...(failure ? {} : { status: "assembling_profile" }),
            generated_assets: assets,
            actual_cost_usd: Number((((job.actual_cost_usd as number | null) ?? 0) + costUsd).toFixed(6)),
          })
          .eq("id", job.id)
          .eq("status", "generating_assets");
        if (saveError) throw new Error(saveError.message);
        if (failure) throw failure.reason instanceof Error ? failure.reason : new Error("No se pudo generar uno de los assets visuales.");

        await enqueueVipProfileJobStep(job.id as string);
        return NextResponse.json({ ok: true, status: "assembling_profile", assets });
      }
      case "assembling_profile": {
        const copy = job.generated_copy as unknown as ProfileCopy;
        const assets = (job.generated_assets as unknown as GeneratedAsset[] | null) ?? [];
        const cover = assets.find((a) => a.kind === "cover");
        const logo = assets.find((a) => a.kind === "logo");

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
