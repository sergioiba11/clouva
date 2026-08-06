import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadGeneratedMedia } from "@/lib/gcs-media";
import { detectLogoInReference } from "./analyze-logo-source";
import { buildLogoBrief } from "./build-logo-brief";
import { fingerprintLogo } from "./fingerprint-logo";
import { generateLogoCandidateVariants } from "./generate-logo";
import { checkUniqueness } from "./validate-uniqueness";
import type {
  DetectedLogo,
  LogoCandidateUrls,
  LogoCandidateVariants,
  LogoFingerprint,
  LogoGenerationRequest,
  ResolveBrandAssetResult,
} from "./types";

const MAX_UNIQUENESS_ATTEMPTS = 3;

type BrandAssetRow = { id: string; owner_type: string; owner_id: string; active_version_id: string | null };
type BrandAssetVersionRow = {
  id: string;
  status: string;
  primary_logo_url: string | null;
  symbol_logo_url: string | null;
  horizontal_logo_url: string | null;
  vertical_logo_url: string | null;
  square_logo_url: string | null;
  transparent_logo_url: string | null;
  white_logo_url: string | null;
  black_logo_url: string | null;
  favicon_url: string | null;
};

async function findActiveBrandAsset(admin: SupabaseClient, ownerType: string, ownerId: string): Promise<BrandAssetRow | null> {
  const { data, error } = await admin
    .from("brand_assets")
    .select("id, owner_type, owner_id, active_version_id")
    .eq("owner_type", ownerType)
    .eq("owner_id", ownerId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer brand_assets: ${error.message}`);
  return data as BrandAssetRow | null;
}

async function getBrandAssetVersion(admin: SupabaseClient, versionId: string): Promise<BrandAssetVersionRow | null> {
  const { data, error } = await admin
    .from("brand_asset_versions")
    .select("id, status, primary_logo_url, symbol_logo_url, horizontal_logo_url, vertical_logo_url, square_logo_url, transparent_logo_url, white_logo_url, black_logo_url, favicon_url")
    .eq("id", versionId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer brand_asset_versions: ${error.message}`);
  return data as BrandAssetVersionRow | null;
}

function urlsFromVersion(version: BrandAssetVersionRow): LogoCandidateUrls | null {
  if (!version.primary_logo_url) return null;
  return {
    primary_logo_url: version.primary_logo_url,
    symbol_logo_url: version.symbol_logo_url ?? version.primary_logo_url,
    horizontal_logo_url: version.horizontal_logo_url ?? version.primary_logo_url,
    vertical_logo_url: version.vertical_logo_url ?? version.primary_logo_url,
    square_logo_url: version.square_logo_url ?? version.primary_logo_url,
    transparent_logo_url: version.transparent_logo_url ?? version.primary_logo_url,
    white_logo_url: version.white_logo_url ?? version.primary_logo_url,
    black_logo_url: version.black_logo_url ?? version.primary_logo_url,
    favicon_url: version.favicon_logo_url ?? version.primary_logo_url,
  };
}

async function uploadAllVariants(ownerType: string, ownerId: string, variants: LogoCandidateVariants): Promise<LogoCandidateUrls> {
  const pathPrefix = `public-identity/${ownerType}s/${ownerId}/brand-logo`;
  const [primary, symbol, horizontal, vertical, square, transparent, white, black, favicon] = await Promise.all([
    uploadGeneratedMedia({ bytes: variants.primary.bytes, mimeType: variants.primary.mimeType, pathPrefix: `${pathPrefix}/primary` }),
    uploadGeneratedMedia({ bytes: variants.symbol.bytes, mimeType: variants.symbol.mimeType, pathPrefix: `${pathPrefix}/symbol` }),
    uploadGeneratedMedia({ bytes: variants.horizontal.bytes, mimeType: variants.horizontal.mimeType, pathPrefix: `${pathPrefix}/horizontal` }),
    uploadGeneratedMedia({ bytes: variants.vertical.bytes, mimeType: variants.vertical.mimeType, pathPrefix: `${pathPrefix}/vertical` }),
    uploadGeneratedMedia({ bytes: variants.square.bytes, mimeType: variants.square.mimeType, pathPrefix: `${pathPrefix}/square` }),
    uploadGeneratedMedia({ bytes: variants.transparent.bytes, mimeType: variants.transparent.mimeType, pathPrefix: `${pathPrefix}/transparent` }),
    uploadGeneratedMedia({ bytes: variants.white.bytes, mimeType: variants.white.mimeType, pathPrefix: `${pathPrefix}/white` }),
    uploadGeneratedMedia({ bytes: variants.black.bytes, mimeType: variants.black.mimeType, pathPrefix: `${pathPrefix}/black` }),
    uploadGeneratedMedia({ bytes: variants.favicon.bytes, mimeType: variants.favicon.mimeType, pathPrefix: `${pathPrefix}/favicon` }),
  ]);
  return {
    primary_logo_url: primary,
    symbol_logo_url: symbol,
    horizontal_logo_url: horizontal,
    vertical_logo_url: vertical,
    square_logo_url: square,
    transparent_logo_url: transparent,
    white_logo_url: white,
    black_logo_url: black,
    favicon_url: favicon,
  };
}

function pickBestOrientationUrl(urls: LogoCandidateUrls, detected: DetectedLogo): string {
  const orientation = detected.visualSignature?.orientation;
  if (orientation === "horizontal") return urls.horizontal_logo_url;
  if (orientation === "vertical") return urls.vertical_logo_url;
  return urls.primary_logo_url;
}

async function reuseOfficialAsset(args: {
  admin: SupabaseClient;
  request: LogoGenerationRequest;
  brandAsset: BrandAssetRow;
  publishedVersion: BrandAssetVersionRow;
}): Promise<ResolveBrandAssetResult> {
  const { admin, request, brandAsset, publishedVersion } = args;
  const urls = urlsFromVersion(publishedVersion);

  let detectedLogo: DetectedLogo | null = null;
  const costUsd = 0;
  if (request.referenceImages.length > 0 && process.env.GEMINI_API_KEY) {
    try {
      detectedLogo = await detectLogoInReference({ apiKey: process.env.GEMINI_API_KEY, referenceImage: request.referenceImages[0] });
    } catch {
      detectedLogo = null;
    }
  }

  const { data: job, error: jobError } = await admin
    .from("brand_generation_jobs")
    .insert({
      owner_type: request.ownerType,
      owner_id: request.ownerId,
      status: "completed",
      source: request.source,
      identity_facts: request.facts,
      detected_logo: detectedLogo ?? {},
      candidates: [],
      result_brand_asset_version_id: publishedVersion.id,
      actual_cost_usd: costUsd,
      created_by: request.createdBy ?? null,
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (jobError) throw new Error(`No se pudo registrar el job de reuso: ${jobError.message}`);

  const finalUrls: LogoCandidateUrls | null = urls && detectedLogo
    ? { ...urls, primary_logo_url: pickBestOrientationUrl(urls, detectedLogo) }
    : urls;

  return {
    jobId: job.id as string,
    brandAssetId: brandAsset.id,
    brandAssetVersionId: publishedVersion.id,
    status: "reused_official",
    urls: finalUrls,
    detectedLogo,
    costUsd,
  };
}

export async function resolveBrandAsset(admin: SupabaseClient, request: LogoGenerationRequest): Promise<ResolveBrandAssetResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no está configurada.");

  let brandAsset = await findActiveBrandAsset(admin, request.ownerType, request.ownerId);

  if (!request.forceRedesign && brandAsset?.active_version_id) {
    const publishedVersion = await getBrandAssetVersion(admin, brandAsset.active_version_id);
    if (publishedVersion?.status === "published") {
      return reuseOfficialAsset({ admin, request, brandAsset, publishedVersion });
    }
  }

  const { data: jobRow, error: jobInsertError } = await admin
    .from("brand_generation_jobs")
    .insert({
      owner_type: request.ownerType,
      owner_id: request.ownerId,
      status: "analyzing_source",
      source: request.source,
      reference_image_urls: [],
      identity_facts: request.facts,
    })
    .select("id")
    .single();
  if (jobInsertError) throw new Error(`No se pudo crear el job de generación de logo: ${jobInsertError.message}`);
  const jobId = jobRow.id as string;

  try {
    let detected: DetectedLogo = { detected: false, confidence: 0, box: null, logoType: null, visualSignature: null };
    if (request.referenceImages.length > 0) {
      await admin.from("brand_generation_jobs").update({ status: "detecting_logo" }).eq("id", jobId);
      detected = await detectLogoInReference({ apiKey, referenceImage: request.referenceImages[0] });
    }
    await admin.from("brand_generation_jobs").update({ detected_logo: detected }).eq("id", jobId);

    const prompts = buildLogoBrief({ name: request.name, detected });

    await admin.from("brand_generation_jobs").update({ status: "generating_candidates" }).eq("id", jobId);

    const rejectedCandidates: LogoFingerprint[] = [];
    const candidatesLog: Array<{ attempt: number; fingerprint: LogoFingerprint; rejected: boolean; rejection_reason: string | null }> = [];
    let accepted: { variants: LogoCandidateVariants; fingerprint: LogoFingerprint } | null = null;
    let totalCostUsd = 0;

    for (let attempt = 1; attempt <= MAX_UNIQUENESS_ATTEMPTS && !accepted; attempt += 1) {
      const { variants, costUsd } = await generateLogoCandidateVariants({ admin, apiKey, prompts });
      totalCostUsd += costUsd;
      const fingerprint = await fingerprintLogo(variants.primary.bytes);

      await admin.from("brand_generation_jobs").update({ status: "checking_uniqueness" }).eq("id", jobId);
      const uniqueness = await checkUniqueness(admin, fingerprint, rejectedCandidates);

      if (uniqueness.unique) {
        accepted = { variants, fingerprint };
        candidatesLog.push({ attempt, fingerprint, rejected: false, rejection_reason: null });
      } else {
        rejectedCandidates.push(fingerprint);
        candidatesLog.push({ attempt, fingerprint, rejected: true, rejection_reason: uniqueness.reason });
      }
      await admin.from("brand_generation_jobs").update({ candidates: candidatesLog, actual_cost_usd: totalCostUsd }).eq("id", jobId);
    }

    if (!accepted) {
      await admin
        .from("brand_generation_jobs")
        .update({ status: "failed", error_message: "No se pudo generar un logo único después de varios intentos.", actual_cost_usd: totalCostUsd, completed_at: new Date().toISOString() })
        .eq("id", jobId);
      throw new Error("No se pudo generar un logo único después de varios intentos.");
    }

    const urls = await uploadAllVariants(request.ownerType, request.ownerId, accepted.variants);

    if (!brandAsset) {
      const { data: newAsset, error: newAssetError } = await admin
        .from("brand_assets")
        .insert({ owner_type: request.ownerType, owner_id: request.ownerId, name: request.name, created_by: request.createdBy ?? null })
        .select("id, owner_type, owner_id, active_version_id")
        .single();
      if (newAssetError) throw new Error(`No se pudo crear brand_assets: ${newAssetError.message}`);
      brandAsset = newAsset as BrandAssetRow;
    }

    const { data: versionRow, error: versionInsertError } = await admin
      .from("brand_asset_versions")
      .insert({
        brand_asset_id: brandAsset.id,
        source_type: request.source,
        primary_logo_url: urls.primary_logo_url,
        symbol_logo_url: urls.symbol_logo_url,
        horizontal_logo_url: urls.horizontal_logo_url,
        vertical_logo_url: urls.vertical_logo_url,
        square_logo_url: urls.square_logo_url,
        transparent_logo_url: urls.transparent_logo_url,
        white_logo_url: urls.white_logo_url,
        black_logo_url: urls.black_logo_url,
        favicon_url: urls.favicon_url,
        palette: detected.visualSignature?.palette ?? [],
        visual_analysis: detected,
        fingerprint: accepted.fingerprint,
        status: "draft",
      })
      .select("id")
      .single();
    if (versionInsertError) throw new Error(`No se pudo guardar brand_asset_versions: ${versionInsertError.message}`);
    const brandAssetVersionId = versionRow.id as string;

    await admin
      .from("brand_generation_jobs")
      .update({ status: "awaiting_review", result_brand_asset_version_id: brandAssetVersionId, actual_cost_usd: totalCostUsd, completed_at: new Date().toISOString() })
      .eq("id", jobId);

    return {
      jobId,
      brandAssetId: brandAsset.id,
      brandAssetVersionId,
      status: "awaiting_review",
      urls,
      detectedLogo: detected,
      costUsd: totalCostUsd,
    };
  } catch (error) {
    await admin
      .from("brand_generation_jobs")
      .update({ status: "failed", error_message: error instanceof Error ? error.message : "Fallo desconocido.", completed_at: new Date().toISOString() })
      .eq("id", jobId)
      .neq("status", "failed");
    throw error;
  }
}
