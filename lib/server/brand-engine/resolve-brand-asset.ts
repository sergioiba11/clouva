import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadGeneratedMedia } from "@/lib/gcs-media";
import { detectLogoInReference } from "./analyze-logo-source";
import { buildMasterSymbolPrompt } from "./build-logo-brief";
import { composeLogoLockups } from "./compose-logo-lockups";
import { fingerprintLogo } from "./fingerprint-logo";
import { generateMasterSymbol } from "./generate-logo";
import { importRealBrandAsset } from "./import-real-brand-asset";
import { runBrandClearance } from "./ip-clearance/classify-ip-risk";
import { resolveBrandNaming, suggestTypography } from "./resolve-brand-naming";
import type {
  AnalyzeBrandSourceRequest,
  AnalyzeBrandSourceResult,
  BrandClearanceResult,
  BrandImportMode,
  BrandNaming,
  BrandOwnerType,
  DetectedLogo,
  LogoCandidateUrls,
  LogoCandidateVariants,
  LogoGenerationRequest,
  ResolveBrandAssetResult,
  TypographyConfig,
} from "./types";

const EMPTY_DETECTED_LOGO: DetectedLogo = {
  detected: false,
  confidence: 0,
  primaryBox: null,
  occurrences: [],
  logoType: null,
  visibleText: { primaryName: null, descriptor: null, otherText: [] },
  lockupStructure: null,
  visualSignature: null,
};

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
  original_asset_url?: string | null;
  cleaned_asset_url?: string | null;
  standalone_symbol_available?: boolean | null;
  clearance_status?: string | null;
  generation_metadata: { naming?: BrandNaming; typography?: TypographyConfig; importMode?: BrandImportMode } | null;
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
    .select("id,status,primary_logo_url,symbol_logo_url,horizontal_logo_url,vertical_logo_url,square_logo_url,transparent_logo_url,white_logo_url,black_logo_url,favicon_url,original_asset_url,cleaned_asset_url,standalone_symbol_available,clearance_status,generation_metadata")
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
    favicon_url: version.favicon_url ?? version.primary_logo_url,
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

async function ensureBrandAsset(args: {
  admin: SupabaseClient;
  existing: BrandAssetRow | null;
  ownerType: BrandOwnerType;
  ownerId: string;
  name: string;
  createdBy: string | null;
}): Promise<BrandAssetRow> {
  if (args.existing) return args.existing;
  const { data, error } = await args.admin
    .from("brand_assets")
    .insert({ owner_type: args.ownerType, owner_id: args.ownerId, name: args.name, created_by: args.createdBy })
    .select("id,owner_type,owner_id,active_version_id")
    .single();
  if (error) throw new Error(`No se pudo crear brand_assets: ${error.message}`);
  return data as BrandAssetRow;
}

function categoriesFromFacts(facts: Record<string, unknown>): string[] {
  const values: string[] = [];
  for (const key of ["professional_categories", "services", "categories", "genres"]) {
    const raw = facts[key];
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      if (typeof item === "string") values.push(item);
      else if (item && typeof item === "object" && "name" in item && typeof (item as { name?: unknown }).name === "string") values.push((item as { name: string }).name);
    }
  }
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, 20);
}

function countryFromFacts(facts: Record<string, unknown>): string | null {
  return typeof facts.country === "string" && facts.country.trim() ? facts.country.trim() : null;
}

async function saveClearanceCheck(args: {
  admin: SupabaseClient;
  versionId: string;
  ownerType: BrandOwnerType;
  ownerId: string;
  clearance: BrandClearanceResult;
}): Promise<string> {
  const { data, error } = await args.admin
    .from("brand_clearance_checks")
    .insert({
      brand_asset_version_id: args.versionId,
      owner_type: args.ownerType,
      owner_id: args.ownerId,
      status: args.clearance.status,
      internal_similarity_score: args.clearance.internal.highestSimilarity,
      external_name_risk_score: args.clearance.external.nameRisk,
      external_visual_risk_score: args.clearance.external.visualRisk,
      class_overlap_score: args.clearance.external.classOverlap,
      sources_checked: args.clearance.external.sourcesChecked,
      internal_matches: args.clearance.internal.matches,
      external_matches: args.clearance.external.matches,
      decision_reasons: args.clearance.decisionReasons,
      checked_at: args.clearance.checkedAt,
    })
    .select("id")
    .single();
  if (error) throw new Error(`No se pudo guardar brand_clearance_checks: ${error.message}`);
  return data.id as string;
}

function pickBestOrientationUrl(urls: LogoCandidateUrls, detected: DetectedLogo): string {
  const orientation = detected.lockupStructure?.orientation;
  if (orientation === "horizontal") return urls.horizontal_logo_url;
  if (orientation === "vertical") return urls.vertical_logo_url;
  return urls.primary_logo_url;
}

export async function analyzeBrandSource(admin: SupabaseClient, request: AnalyzeBrandSourceRequest): Promise<AnalyzeBrandSourceResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no está configurada.");

  const detectedLogo = request.referenceImages.length > 0
    ? await detectLogoInReference({ apiKey, referenceImage: request.referenceImages[0] })
    : EMPTY_DETECTED_LOGO;

  const brandAsset = await findActiveBrandAsset(admin, request.ownerType, request.ownerId);
  let officialNaming: { displayName: string; descriptor: string | null } | null = null;
  if (brandAsset?.active_version_id) {
    const officialVersion = await getBrandAssetVersion(admin, brandAsset.active_version_id);
    const officialMeta = officialVersion?.generation_metadata?.naming;
    if (officialVersion?.status === "published" && officialMeta) officialNaming = { displayName: officialMeta.displayName, descriptor: officialMeta.descriptor };
  }

  const naming = resolveBrandNaming({ entityName: request.entityName, detectedLogo, officialNaming });
  return { detectedLogo, naming, suggestedTypography: suggestTypography(detectedLogo) };
}

async function reuseOfficialAsset(args: {
  admin: SupabaseClient;
  request: LogoGenerationRequest;
  brandAsset: BrandAssetRow;
  publishedVersion: BrandAssetVersionRow;
}): Promise<ResolveBrandAssetResult> {
  const urls = urlsFromVersion(args.publishedVersion);
  const naming = args.publishedVersion.generation_metadata?.naming ?? null;
  let detectedLogo: DetectedLogo | null = args.request.detectedLogo ?? null;
  if (!detectedLogo && args.request.referenceImages.length > 0 && process.env.GEMINI_API_KEY) {
    try {
      detectedLogo = await detectLogoInReference({ apiKey: process.env.GEMINI_API_KEY, referenceImage: args.request.referenceImages[0] });
    } catch {
      detectedLogo = null;
    }
  }

  const { data: job, error } = await args.admin
    .from("brand_generation_jobs")
    .insert({
      owner_type: args.request.ownerType,
      owner_id: args.request.ownerId,
      status: "completed",
      source: args.request.source,
      identity_facts: args.request.facts,
      detected_logo: detectedLogo ?? {},
      candidates: [],
      result_brand_asset_version_id: args.publishedVersion.id,
      actual_cost_usd: 0,
      created_by: args.request.createdBy ?? null,
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(`No se pudo registrar el job de reuso: ${error.message}`);

  const finalUrls = urls && detectedLogo ? { ...urls, primary_logo_url: pickBestOrientationUrl(urls, detectedLogo) } : urls;
  return {
    jobId: job.id as string,
    brandAssetId: args.brandAsset.id,
    brandAssetVersionId: args.publishedVersion.id,
    status: "reused_official",
    mode: args.publishedVersion.generation_metadata?.importMode ?? "real_identity_import",
    urls: finalUrls,
    originalAssetUrl: args.publishedVersion.original_asset_url ?? null,
    cleanedAssetUrl: args.publishedVersion.cleaned_asset_url ?? null,
    standaloneSymbolAvailable: Boolean(args.publishedVersion.standalone_symbol_available),
    clearance: null,
    detectedLogo,
    naming,
    costUsd: 0,
  };
}

async function importAndValidateRealIdentity(args: {
  admin: SupabaseClient;
  request: LogoGenerationRequest;
  brandAsset: BrandAssetRow | null;
  detectedLogo: DetectedLogo;
  naming: BrandNaming;
}): Promise<ResolveBrandAssetResult> {
  if (!args.detectedLogo.primaryBox || args.request.referenceImages.length === 0) throw new Error("Falta un recorte confirmado de la identidad real.");
  if (args.request.sourceKind === "reference_only") throw new Error("Una referencia ajena no puede importarse como identidad propia. Usá Rediseñar identidad.");

  const { data: jobRow, error: jobError } = await args.admin
    .from("brand_generation_jobs")
    .insert({
      owner_type: args.request.ownerType,
      owner_id: args.request.ownerId,
      status: "importing_identity",
      source: args.request.source,
      reference_image_urls: args.request.referenceImageUrls ?? [],
      identity_facts: args.request.facts,
      detected_logo: args.detectedLogo,
      actual_cost_usd: 0,
      created_by: args.request.createdBy ?? null,
    })
    .select("id")
    .single();
  if (jobError) throw new Error(`No se pudo crear el job de importación: ${jobError.message}`);
  const jobId = jobRow.id as string;

  try {
    const imported = await importRealBrandAsset({
      referenceBytes: Buffer.from(args.request.referenceImages[0].data, "base64"),
      sourceImageUrl: args.request.referenceImageUrls?.[0] ?? null,
      sourceBox: args.detectedLogo.primaryBox,
      extractionMethod: args.request.extractionMethod ?? "confirmed_detected_crop",
    });
    const fingerprint = await fingerprintLogo(imported.master.originalBytes);
    await args.admin.from("brand_generation_jobs").update({ status: "checking_clearance", candidates: [{ fingerprint, imported: true }] }).eq("id", jobId);

    const clearance = await runBrandClearance({
      admin: args.admin,
      ownerType: args.request.ownerType,
      ownerId: args.request.ownerId,
      fingerprint,
      naming: args.naming,
      imageBytes: imported.master.originalBytes,
      categories: categoriesFromFacts(args.request.facts),
      country: countryFromFacts(args.request.facts),
    });

    const brandAsset = await ensureBrandAsset({
      admin: args.admin,
      existing: args.brandAsset,
      ownerType: args.request.ownerType,
      ownerId: args.request.ownerId,
      name: args.naming.entityName,
      createdBy: args.request.createdBy ?? null,
    });

    const pathPrefix = `public-identity/${args.request.ownerType}s/${args.request.ownerId}/brand-logo`;
    const [originalAssetUrl, cleanedAssetUrl, urls] = await Promise.all([
      uploadGeneratedMedia({ bytes: imported.master.originalBytes, mimeType: "image/png", pathPrefix: `${pathPrefix}/original` }),
      uploadGeneratedMedia({ bytes: imported.master.cleanedBytes, mimeType: "image/png", pathPrefix: `${pathPrefix}/cleaned` }),
      uploadAllVariants(args.request.ownerType, args.request.ownerId, imported.variants),
    ]);

    const { data: version, error: versionError } = await args.admin
      .from("brand_asset_versions")
      .insert({
        brand_asset_id: brandAsset.id,
        source_type: args.request.source,
        source_mockup_url: args.request.referenceImageUrls?.[0] ?? null,
        primary_logo_url: urls.primary_logo_url,
        symbol_logo_url: urls.symbol_logo_url,
        horizontal_logo_url: urls.horizontal_logo_url,
        vertical_logo_url: urls.vertical_logo_url,
        square_logo_url: urls.square_logo_url,
        transparent_logo_url: urls.transparent_logo_url,
        white_logo_url: urls.white_logo_url,
        black_logo_url: urls.black_logo_url,
        favicon_url: urls.favicon_url,
        palette: args.detectedLogo.visualSignature?.palette ?? [],
        visual_analysis: args.detectedLogo,
        generation_metadata: {
          naming: args.naming,
          importMode: "real_identity_import",
          extractionMethod: imported.master.extractionMethod,
          standalone_symbol_available: false,
          symbol_fallback: "full_lockup_contain",
          geminiImageGenerationCalled: false,
        },
        fingerprint,
        import_mode: "real_identity_import",
        source_crop: imported.master.sourceBox,
        original_asset_url: originalAssetUrl,
        cleaned_asset_url: cleanedAssetUrl,
        standalone_symbol_available: false,
        clearance_status: clearance.status,
        ownership_attested: args.request.ownershipAttested === true,
        ownership_attested_by: args.request.ownershipAttested === true ? args.request.ownershipAttestedBy ?? args.request.createdBy ?? null : null,
        ownership_attested_at: args.request.ownershipAttested === true ? new Date().toISOString() : null,
        source_kind: args.request.sourceKind ?? "own_mockup",
        source_note: args.request.sourceNote ?? null,
        status: "draft",
      })
      .select("id")
      .single();
    if (versionError) throw new Error(`No se pudo guardar la identidad importada: ${versionError.message}`);

    const clearanceCheckId = await saveClearanceCheck({
      admin: args.admin,
      versionId: version.id as string,
      ownerType: args.request.ownerType,
      ownerId: args.request.ownerId,
      clearance,
    });
    await args.admin.from("brand_asset_versions").update({ clearance_check_id: clearanceCheckId }).eq("id", version.id);
    await args.admin.from("brand_generation_jobs").update({ status: "completed", result_brand_asset_version_id: version.id, actual_cost_usd: 0, completed_at: new Date().toISOString() }).eq("id", jobId);

    return {
      jobId,
      brandAssetId: brandAsset.id,
      brandAssetVersionId: version.id as string,
      status: "awaiting_review",
      mode: "real_identity_import",
      urls,
      originalAssetUrl,
      cleanedAssetUrl,
      standaloneSymbolAvailable: false,
      clearance,
      detectedLogo: args.detectedLogo,
      naming: args.naming,
      costUsd: 0,
    };
  } catch (error) {
    await args.admin.from("brand_generation_jobs").update({ status: "failed", error_message: error instanceof Error ? error.message : "Fallo importando identidad.", completed_at: new Date().toISOString() }).eq("id", jobId);
    throw error;
  }
}

async function generateAndValidateNewIdentity(args: {
  admin: SupabaseClient;
  request: LogoGenerationRequest;
  brandAsset: BrandAssetRow | null;
  detectedLogo: DetectedLogo;
  naming: BrandNaming;
  typography: TypographyConfig;
}): Promise<ResolveBrandAssetResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no está configurada.");
  const mode: BrandImportMode = args.request.forceRedesign ? "clouva_generated_redesign" : "standalone_creation";
  const fidelity = args.request.referenceFidelity ?? (args.detectedLogo.detected ? "high" : "balanced");

  const { data: jobRow, error: jobError } = await args.admin
    .from("brand_generation_jobs")
    .insert({
      owner_type: args.request.ownerType,
      owner_id: args.request.ownerId,
      status: "generating_candidates",
      source: args.request.source,
      reference_image_urls: args.request.referenceImageUrls ?? [],
      identity_facts: args.request.facts,
      detected_logo: args.detectedLogo,
      created_by: args.request.createdBy ?? null,
    })
    .select("id")
    .single();
  if (jobError) throw new Error(`No se pudo crear el job de generación: ${jobError.message}`);
  const jobId = jobRow.id as string;

  try {
    const prompt = buildMasterSymbolPrompt({ entityName: args.naming.entityName, detected: args.detectedLogo, fidelity });
    const generated = await generateMasterSymbol({ admin: args.admin, apiKey, prompt });
    const fingerprint = await fingerprintLogo(generated.bytes);
    await args.admin.from("brand_generation_jobs").update({ status: "checking_clearance", candidates: [{ attempt: 1, fingerprint, rejected: false }], actual_cost_usd: generated.costUsd }).eq("id", jobId);

    const clearance = await runBrandClearance({
      admin: args.admin,
      ownerType: args.request.ownerType,
      ownerId: args.request.ownerId,
      fingerprint,
      naming: args.naming,
      imageBytes: generated.bytes,
      categories: categoriesFromFacts(args.request.facts),
      country: countryFromFacts(args.request.facts),
    });
    const variants = await composeLogoLockups({ masterSymbolBytes: generated.bytes, naming: args.naming, typography: args.typography, lockupStructure: args.detectedLogo.lockupStructure });
    const urls = await uploadAllVariants(args.request.ownerType, args.request.ownerId, variants);
    const brandAsset = await ensureBrandAsset({
      admin: args.admin,
      existing: args.brandAsset,
      ownerType: args.request.ownerType,
      ownerId: args.request.ownerId,
      name: args.naming.entityName,
      createdBy: args.request.createdBy ?? null,
    });

    const { data: version, error: versionError } = await args.admin
      .from("brand_asset_versions")
      .insert({
        brand_asset_id: brandAsset.id,
        source_type: args.request.source,
        source_mockup_url: args.request.referenceImageUrls?.[0] ?? null,
        primary_logo_url: urls.primary_logo_url,
        symbol_logo_url: urls.symbol_logo_url,
        horizontal_logo_url: urls.horizontal_logo_url,
        vertical_logo_url: urls.vertical_logo_url,
        square_logo_url: urls.square_logo_url,
        transparent_logo_url: urls.transparent_logo_url,
        white_logo_url: urls.white_logo_url,
        black_logo_url: urls.black_logo_url,
        favicon_url: urls.favicon_url,
        palette: args.detectedLogo.visualSignature?.palette ?? [],
        visual_analysis: args.detectedLogo,
        generation_metadata: { naming: args.naming, typography: args.typography, referenceFidelity: fidelity, importMode: mode, geminiImageGenerationCalled: true },
        fingerprint,
        import_mode: mode,
        clearance_status: clearance.status,
        ownership_attested: args.request.ownershipAttested === true,
        ownership_attested_by: args.request.ownershipAttested === true ? args.request.ownershipAttestedBy ?? args.request.createdBy ?? null : null,
        ownership_attested_at: args.request.ownershipAttested === true ? new Date().toISOString() : null,
        source_kind: args.request.sourceKind ?? (args.request.referenceImages.length ? "reference_only" : "own_logo_file"),
        source_note: args.request.sourceNote ?? null,
        standalone_symbol_available: true,
        status: "draft",
      })
      .select("id")
      .single();
    if (versionError) throw new Error(`No se pudo guardar la identidad generada: ${versionError.message}`);

    const clearanceCheckId = await saveClearanceCheck({ admin: args.admin, versionId: version.id as string, ownerType: args.request.ownerType, ownerId: args.request.ownerId, clearance });
    await args.admin.from("brand_asset_versions").update({ clearance_check_id: clearanceCheckId }).eq("id", version.id);
    await args.admin.from("brand_generation_jobs").update({ status: "completed", result_brand_asset_version_id: version.id, actual_cost_usd: generated.costUsd, completed_at: new Date().toISOString() }).eq("id", jobId);

    return {
      jobId,
      brandAssetId: brandAsset.id,
      brandAssetVersionId: version.id as string,
      status: "awaiting_review",
      mode,
      urls,
      originalAssetUrl: null,
      cleanedAssetUrl: null,
      standaloneSymbolAvailable: true,
      clearance,
      detectedLogo: args.detectedLogo,
      naming: args.naming,
      costUsd: generated.costUsd,
    };
  } catch (error) {
    await args.admin.from("brand_generation_jobs").update({ status: "failed", error_message: error instanceof Error ? error.message : "Fallo generando identidad.", completed_at: new Date().toISOString() }).eq("id", jobId);
    throw error;
  }
}

export async function resolveBrandAsset(admin: SupabaseClient, request: LogoGenerationRequest): Promise<ResolveBrandAssetResult> {
  let brandAsset = await findActiveBrandAsset(admin, request.ownerType, request.ownerId);
  if (!request.forceRedesign && brandAsset?.active_version_id) {
    const publishedVersion = await getBrandAssetVersion(admin, brandAsset.active_version_id);
    if (publishedVersion?.status === "published") return reuseOfficialAsset({ admin, request, brandAsset, publishedVersion });
  }

  let detectedLogo = request.detectedLogo ?? null;
  let naming = request.naming ?? null;
  if (!detectedLogo || !naming) {
    const analyzed = await analyzeBrandSource(admin, {
      ownerType: request.ownerType,
      ownerId: request.ownerId,
      entityName: request.entityName,
      source: request.source,
      referenceImages: request.referenceImages,
    });
    detectedLogo = detectedLogo ?? analyzed.detectedLogo;
    naming = naming ?? analyzed.naming;
  }
  const typography = request.typography ?? suggestTypography(detectedLogo);

  if (request.referenceImages.length > 0 && request.forceRedesign !== true) {
    if (!detectedLogo.detected || !detectedLogo.primaryBox) throw new Error("No hay un recorte confirmado para importar. Marcá exactamente la identidad real antes de continuar.");
    return importAndValidateRealIdentity({ admin, request, brandAsset, detectedLogo, naming });
  }

  return generateAndValidateNewIdentity({ admin, request, brandAsset, detectedLogo, naming, typography });
}
