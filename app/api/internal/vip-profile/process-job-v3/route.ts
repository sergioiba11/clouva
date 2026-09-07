import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeEqualHex } from "@/core/integrations/instagram/crypto";
import { POST as processLegacyJob } from "@/app/api/internal/vip-profile/process-job/route";
import { enqueueVipProfileJobStep } from "@/lib/server/cloud-tasks";
import { fetchReferenceImages, type GeneratedAsset } from "@/lib/server/vip-profile-assets";
import { pickAccentFromPalette, sanitizeLayoutConfig } from "@/lib/server/layout-config";
import { createAdminSupabase } from "@/lib/server/supabase";
import { compareReferenceRender } from "@/lib/server/visual-correction-gemini";
import { applyVisualCorrectionPatch } from "@/lib/server/visual-correction-patch";
import type { ProfileCopy } from "@/lib/server/vip-profile-gemini";
import {
  REFERENCE_FIDELITY_TARGET_SCORE,
  captureReferencePreview,
  createReferenceFidelityState,
  inferReferenceViewport,
  readReferenceFidelityState,
  withReferenceFidelityState,
} from "@/lib/server/reference-fidelity-v3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const V3_STATUSES = new Set([
  "rendering_reference_preview",
  "capturing_reference_render",
  "comparing_reference",
  "applying_visual_corrections",
  "validating_visual_fidelity",
]);

function isAuthorized(request: NextRequest) {
  const provided = request.headers.get("x-clouva-vip-task-secret")?.trim() ?? "";
  const expected = process.env.VIP_PROFILE_TASK_SECRET?.trim() ?? "";
  return Boolean(expected) && safeEqualHex(provided, expected);
}

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

function layoutReferenceIndex(layoutAnalysis: unknown) {
  if (!layoutAnalysis || typeof layoutAnalysis !== "object") return 0;
  const images = Array.isArray((layoutAnalysis as Record<string, unknown>).images)
    ? (layoutAnalysis as Record<string, unknown>).images as Array<Record<string, unknown>>
    : [];
  const item = images.find((entry) => entry?.is_layout_relevant === true);
  return typeof item?.index === "number" ? Math.max(0, Math.floor(item.index)) : 0;
}

async function createReferenceDraft(admin: SupabaseClient, job: Record<string, unknown>) {
  const copy = job.generated_copy as unknown as ProfileCopy;
  const assets = (job.generated_assets as unknown as GeneratedAsset[] | null) ?? [];
  const cover = assets.find((asset) => asset.kind === "cover");
  const logo = assets.find((asset) => asset.kind === "logo");
  const sanitizedLayout = sanitizeLayoutConfig(job.generated_layout);
  if (!sanitizedLayout || sanitizedLayout.layout_kind !== "precise") {
    throw new Error("Reference Fidelity necesita un layout precise válido.");
  }
  if (!sanitizedLayout.page_style?.palette?.accent) {
    const accent = pickAccentFromPalette(copy.palette);
    if (accent) sanitizedLayout.page_style = { ...sanitizedLayout.page_style, palette: { ...sanitizedLayout.page_style?.palette, accent } };
  }

  const isPlayer = Boolean(job.player_id);
  const subjectColumn = isPlayer ? "player_id" : "studio_id";
  const subjectId = (job.player_id || job.studio_id) as string;
  const { data: lastVersion, error: lastVersionError } = await admin
    .from("player_profile_versions")
    .select("version_number")
    .eq(subjectColumn, subjectId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastVersionError) throw new Error(lastVersionError.message);

  const { data: version, error: versionError } = await admin
    .from("player_profile_versions")
    .insert({
      player_id: job.player_id || null,
      studio_id: job.studio_id || null,
      generation_job_id: job.id,
      version_number: ((lastVersion?.version_number as number | null) ?? 0) + 1,
      status: "draft",
      profile_level: "vip",
      template_key: "vip_default",
      copy_config: copy,
      visual_config: { energy: copy.visual_energy, tone: copy.visual_tone, palette: copy.palette },
      asset_references: [
        ...(cover ? [{ kind: "cover", url: cover.url }] : []),
        ...(logo ? [{ kind: "logo", url: logo.url }] : []),
      ],
      layout_config: sanitizedLayout,
      brand_asset_version_id: (job.brand_asset_version_id as string | null) ?? null,
      source_snapshot: job.identity_brief,
    })
    .select("id")
    .single();
  if (versionError) throw new Error(versionError.message);
  return { versionId: version.id as string, layout: sanitizedLayout };
}

async function loadTarget(job: Record<string, unknown>) {
  const urls = (job.reference_image_urls as string[] | null) ?? [];
  const images = urls.length ? await fetchReferenceImages(urls) : [];
  if (!images.length) return { target: null, viewport: null };
  const index = Math.min(layoutReferenceIndex(job.layout_analysis), images.length - 1);
  const target = images[index] ?? images[0];
  return { target, viewport: inferReferenceViewport(target) };
}

async function processV3(request: NextRequest, jobId: string, status: string, job: Record<string, unknown>) {
  const admin = createAdminSupabase();

  if (status === "assembling_profile") {
    const analysis = job.layout_analysis && typeof job.layout_analysis === "object" ? job.layout_analysis as Record<string, unknown> : {};
    if (analysis.mode !== "reference_layout" || !job.studio_id) return processLegacyJob(request);

    const existingVersion = await admin.from("player_profile_versions").select("id").eq("generation_job_id", jobId).eq("status", "draft").maybeSingle();
    if (existingVersion.error) throw new Error(existingVersion.error.message);
    const draft = existingVersion.data?.id
      ? { versionId: existingVersion.data.id as string, layout: sanitizeLayoutConfig(job.generated_layout) }
      : await createReferenceDraft(admin, job);
    if (!draft.layout) throw new Error("No se pudo recuperar el layout precise del borrador.");

    const { viewport } = await loadTarget(job);
    if (!viewport) {
      await claim(admin, jobId, "assembling_profile", "review_ready", { completed_at: new Date().toISOString() });
      return NextResponse.json({ ok: true, status: "review_ready", versionId: draft.versionId, note: "Borrador listo; comparación visual pendiente porque la referencia no tiene dimensiones legibles." });
    }

    const fidelity = createReferenceFidelityState(viewport, draft.versionId);
    const claimed = await claim(admin, jobId, "assembling_profile", "rendering_reference_preview", {
      layout_analysis: withReferenceFidelityState(job.layout_analysis, fidelity),
    });
    if (claimed) await enqueueVipProfileJobStep(jobId);
    return NextResponse.json({ ok: true, status: claimed ? "rendering_reference_preview" : status, versionId: draft.versionId });
  }

  const fidelity = readReferenceFidelityState(job.layout_analysis);
  if (!fidelity?.versionId) throw new Error("Falta el estado de Reference Fidelity del borrador.");

  if (status === "rendering_reference_preview") {
    const next = { ...fidelity, stage: "capturing_reference_render" };
    const claimed = await claim(admin, jobId, status, "capturing_reference_render", { layout_analysis: withReferenceFidelityState(job.layout_analysis, next) });
    if (claimed) await enqueueVipProfileJobStep(jobId);
    return NextResponse.json({ ok: true, status: claimed ? "capturing_reference_render" : status });
  }

  if (status === "capturing_reference_render") {
    const next = { ...fidelity, stage: "comparing_reference" };
    const claimed = await claim(admin, jobId, status, "comparing_reference", { layout_analysis: withReferenceFidelityState(job.layout_analysis, next) });
    if (claimed) await enqueueVipProfileJobStep(jobId);
    return NextResponse.json({ ok: true, status: claimed ? "comparing_reference" : status });
  }

  if (status === "comparing_reference") {
    const [{ data: version, error: versionError }, targetResult] = await Promise.all([
      admin.from("player_profile_versions").select("id,status,layout_config").eq("id", fidelity.versionId).maybeSingle(),
      loadTarget(job),
    ]);
    if (versionError) throw new Error(versionError.message);
    if (!version || version.status !== "draft") throw new Error("El borrador de Reference Fidelity ya no está disponible.");
    const layout = sanitizeLayoutConfig(version.layout_config);
    if (!layout || layout.layout_kind !== "precise" || !targetResult.target) throw new Error("No hay target/layout precise válido para comparar.");
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY no está configurada.");

    try {
      const render = await captureReferencePreview({ versionId: fidelity.versionId, viewport: fidelity.referenceViewport });
      const comparison = await compareReferenceRender({ apiKey, target: targetResult.target, render, layout });
      const nextIteration = fidelity.iteration + 1;
      const history = [...fidelity.history, {
        iteration: nextIteration,
        scoreBefore: fidelity.visualScore,
        scoreAfter: comparison.visualScore,
        model: comparison.model,
        costUsd: comparison.costUsd,
        corrections: comparison.patch.changes.length,
        timestamp: new Date().toISOString(),
      }].slice(-12);
      const finished = comparison.visualScore >= REFERENCE_FIDELITY_TARGET_SCORE
        || nextIteration >= fidelity.maxIterations
        || comparison.patch.changes.length === 0;
      const next = {
        ...fidelity,
        stage: finished ? "validating_visual_fidelity" : "applying_visual_corrections",
        iteration: nextIteration,
        visualScore: comparison.visualScore,
        summary: comparison.summary,
        structuralMismatch: comparison.structuralMismatch,
        pendingPatch: finished ? null : comparison.patch,
        history,
        lastError: null,
      };
      const nextStatus = finished ? "validating_visual_fidelity" : "applying_visual_corrections";
      const claimed = await claim(admin, jobId, status, nextStatus, {
        layout_analysis: withReferenceFidelityState(job.layout_analysis, next),
        actual_cost_usd: Number((((job.actual_cost_usd as number | null) ?? 0) + comparison.costUsd).toFixed(6)),
      });
      if (claimed) await enqueueVipProfileJobStep(jobId);
      return NextResponse.json({ ok: true, status: claimed ? nextStatus : status, visualScore: comparison.visualScore, iteration: nextIteration });
    } catch (captureOrCompareError) {
      const message = captureOrCompareError instanceof Error ? captureOrCompareError.message : "No se pudo comparar el render.";
      const next = { ...fidelity, stage: "validating_visual_fidelity", pendingPatch: null, lastError: message };
      const claimed = await claim(admin, jobId, status, "validating_visual_fidelity", { layout_analysis: withReferenceFidelityState(job.layout_analysis, next) });
      if (claimed) await enqueueVipProfileJobStep(jobId);
      return NextResponse.json({ ok: true, status: "validating_visual_fidelity", note: "La propuesta se conserva aunque la comparación visual haya fallado." });
    }
  }

  if (status === "applying_visual_corrections") {
    const { data: version, error: versionError } = await admin.from("player_profile_versions").select("id,status,layout_config").eq("id", fidelity.versionId).maybeSingle();
    if (versionError) throw new Error(versionError.message);
    if (!version || version.status !== "draft") throw new Error("El borrador ya no puede corregirse.");
    const layout = sanitizeLayoutConfig(version.layout_config);
    if (!layout || !fidelity.pendingPatch) throw new Error("No hay un patch visual pendiente válido.");
    const corrected = applyVisualCorrectionPatch(layout, fidelity.pendingPatch);
    if (!corrected) throw new Error("El patch visual no produjo un layout válido.");
    const { error: updateVersionError } = await admin.from("player_profile_versions").update({ layout_config: corrected }).eq("id", fidelity.versionId).eq("status", "draft");
    if (updateVersionError) throw new Error(updateVersionError.message);
    const next = { ...fidelity, stage: "rendering_reference_preview", pendingPatch: null };
    const claimed = await claim(admin, jobId, status, "rendering_reference_preview", { generated_layout: corrected, layout_analysis: withReferenceFidelityState(job.layout_analysis, next) });
    if (claimed) await enqueueVipProfileJobStep(jobId);
    return NextResponse.json({ ok: true, status: claimed ? "rendering_reference_preview" : status, iteration: fidelity.iteration });
  }

  if (status === "validating_visual_fidelity") {
    const claimed = await claim(admin, jobId, status, "review_ready", { completed_at: new Date().toISOString() });
    return NextResponse.json({ ok: true, status: claimed ? "review_ready" : status, versionId: fidelity.versionId, visualScore: fidelity.visualScore, fidelityWarning: fidelity.lastError });
  }

  return NextResponse.json({ ok: true, status, note: "Sin paso V3 pendiente." });
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const clone = request.clone();
  const body = await clone.json().catch(() => ({})) as { jobId?: string };
  if (!body.jobId) return NextResponse.json({ error: "Falta jobId." }, { status: 400 });

  const admin = createAdminSupabase();
  const { data: job, error } = await admin
    .from("vip_profile_generation_jobs")
    .select("id,user_id,player_id,studio_id,status,identity_brief,generated_copy,generated_assets,generated_layout,layout_analysis,actual_cost_usd,reference_image_urls,brand_asset_version_id")
    .eq("id", body.jobId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: "El job no existe." }, { status: 404 });

  const shouldUseV3 = job.status === "assembling_profile" || V3_STATUSES.has(job.status as string);
  if (!shouldUseV3) return processLegacyJob(request);

  try {
    return await processV3(request, body.jobId, job.status as string, job as unknown as Record<string, unknown>);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "No se pudo procesar Reference Fidelity.";
    await admin.from("vip_profile_generation_jobs").update({ status: "failed", error_message: message }).eq("id", body.jobId);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
