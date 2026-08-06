import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadGeneratedMedia } from "@/lib/gcs-media";
import { detectLogoInReference } from "./analyze-logo-source";
import { buildBrandKit, buildBrandKitFromSvgs, type BrandKitFiles } from "./brand-kit";
import { buildMasterSymbolPrompt } from "./build-logo-brief";
import { composeLogoLockupSvgs } from "./compose-logo-lockups";
import { fingerprintLogo } from "./fingerprint-logo";
import { generateMasterSymbol } from "./generate-logo";
import { runBrandClearance } from "./ip-clearance/classify-ip-risk";
import { resolveBrandNaming, suggestTypography } from "./resolve-brand-naming";
import { reconstructLogoVector } from "./vector-reconstruct";
import type {
  AnalyzeBrandSourceRequest,
  AnalyzeBrandSourceResult,
  BrandClearanceResult,
  BrandImportMode,
  BrandNaming,
  BrandOwnerType,
  DetectedLogo,
  LogoCandidateUrls,
  LogoGenerationRequest,
  ResolveBrandAssetResult,
  TypographyConfig,
  VectorValidationReport,
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
  decomposition: null,
};

type BrandAssetRow = { id: string; owner_type: string; owner_id: string; active_version_id: string | null };
type BrandAssetVersionRow = {
  id: string;
  status: string;
  import_mode: BrandImportMode | null;
  primary_logo_url: string | null;
  symbol_logo_url: string | null;
  horizontal_logo_url: string | null;
  vertical_logo_url: string | null;
  square_logo_url: string | null;
  transparent_logo_url: string | null;
  white_logo_url: string | null;
  black_logo_url: string | null;
  favicon_url: string | null;
  master_svg_url?: string | null;
  symbol_svg_url?: string | null;
  horizontal_svg_url?: string | null;
  vertical_svg_url?: string | null;
  white_svg_url?: string | null;
  black_svg_url?: string | null;
  monochrome_svg_url?: string | null;
  print_pdf_url?: string | null;
  brand_config_url?: string | null;
  source_reference_url?: string | null;
  reconstruction_preview_url?: string | null;
  standalone_symbol_available?: boolean | null;
  clearance_status?: string | null;
  validation_report?: VectorValidationReport | null;
  generation_metadata: { naming?: BrandNaming; typography?: TypographyConfig; importMode?: BrandImportMode } | null;
};

type UploadedBrandKit = { urls: LogoCandidateUrls; profile1024Url: string; transparent4096Url: string };

async function findActiveBrandAsset(admin: SupabaseClient, ownerType: BrandOwnerType, ownerId: string) {
  const { data, error } = await admin.from("brand_assets").select("id,owner_type,owner_id,active_version_id").eq("owner_type", ownerType).eq("owner_id", ownerId).eq("status", "active").maybeSingle();
  if (error) throw new Error(`No se pudo leer brand_assets: ${error.message}`);
  return data as BrandAssetRow | null;
}

async function getBrandAssetVersion(admin: SupabaseClient, versionId: string) {
  const { data, error } = await admin.from("brand_asset_versions")
    .select("id,status,import_mode,primary_logo_url,symbol_logo_url,horizontal_logo_url,vertical_logo_url,square_logo_url,transparent_logo_url,white_logo_url,black_logo_url,favicon_url,master_svg_url,symbol_svg_url,horizontal_svg_url,vertical_svg_url,white_svg_url,black_svg_url,monochrome_svg_url,print_pdf_url,brand_config_url,source_reference_url,reconstruction_preview_url,standalone_symbol_available,clearance_status,validation_report,generation_metadata")
    .eq("id", versionId).maybeSingle();
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
    master_svg_url: version.master_svg_url ?? null,
    symbol_svg_url: version.symbol_svg_url ?? null,
    horizontal_svg_url: version.horizontal_svg_url ?? null,
    vertical_svg_url: version.vertical_svg_url ?? null,
    white_svg_url: version.white_svg_url ?? null,
    black_svg_url: version.black_svg_url ?? null,
    monochrome_svg_url: version.monochrome_svg_url ?? null,
    print_pdf_url: version.print_pdf_url ?? null,
    brand_config_url: version.brand_config_url ?? null,
  };
}

async function ensureBrandAsset(args: { admin: SupabaseClient; existing: BrandAssetRow | null; ownerType: BrandOwnerType; ownerId: string; name: string; createdBy: string | null }) {
  if (args.existing) return args.existing;
  const { data, error } = await args.admin.from("brand_assets").insert({ owner_type: args.ownerType, owner_id: args.ownerId, name: args.name, created_by: args.createdBy }).select("id,owner_type,owner_id,active_version_id").single();
  if (error) throw new Error(`No se pudo crear brand_assets: ${error.message}`);
  return data as BrandAssetRow;
}

function categoriesFromFacts(facts: Record<string, unknown>) {
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

function countryFromFacts(facts: Record<string, unknown>) {
  return typeof facts.country === "string" && facts.country.trim() ? facts.country.trim() : null;
}

async function saveClearanceCheck(args: { admin: SupabaseClient; versionId: string; ownerType: BrandOwnerType; ownerId: string; clearance: BrandClearanceResult }) {
  const { data, error } = await args.admin.from("brand_clearance_checks").insert({
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
  }).select("id").single();
  if (error) throw new Error(`No se pudo guardar brand_clearance_checks: ${error.message}`);
  return data.id as string;
}

async function uploadBrandKit(args: { kit: BrandKitFiles; ownerType: BrandOwnerType; ownerId: string; versionId: string; naming: BrandNaming; palette: string[]; validation: VectorValidationReport }) {
  const prefix = `public-identity/${args.ownerType}s/${args.ownerId}/brand-logo/${args.versionId}`;
  const svgEntries = Object.entries(args.kit.svgs) as Array<[keyof BrandKitFiles["svgs"], string]>;
  const pngEntries = Object.entries(args.kit.pngs) as Array<[keyof BrandKitFiles["pngs"], { bytes: Buffer; mimeType: string }]>;
  const svgUrls = Object.fromEntries(await Promise.all(svgEntries.map(async ([key, svg]) => [key, await uploadGeneratedMedia({ bytes: Buffer.from(svg), mimeType: "image/svg+xml", pathPrefix: `${prefix}/svg/${key}` })])));
  const pngUrls = Object.fromEntries(await Promise.all(pngEntries.map(async ([key, file]) => [key, await uploadGeneratedMedia({ bytes: file.bytes, mimeType: file.mimeType, pathPrefix: `${prefix}/png/${key}` })])));
  const [printPdfUrl, transparent4096Url, profile1024Url] = await Promise.all([
    uploadGeneratedMedia({ bytes: args.kit.printPdf, mimeType: "application/pdf", pathPrefix: `${prefix}/print` }),
    uploadGeneratedMedia({ bytes: args.kit.transparent4096, mimeType: "image/png", pathPrefix: `${prefix}/transparent-4096` }),
    uploadGeneratedMedia({ bytes: args.kit.profile1024, mimeType: "image/png", pathPrefix: `${prefix}/profile-1024` }),
  ]);
  const urls: LogoCandidateUrls = {
    primary_logo_url: pngUrls.primary as string,
    symbol_logo_url: pngUrls.symbol as string,
    horizontal_logo_url: pngUrls.horizontal as string,
    vertical_logo_url: pngUrls.vertical as string,
    square_logo_url: pngUrls.square as string,
    transparent_logo_url: pngUrls.transparent as string,
    white_logo_url: pngUrls.white as string,
    black_logo_url: pngUrls.black as string,
    favicon_url: pngUrls.favicon as string,
    master_svg_url: svgUrls.master as string,
    symbol_svg_url: svgUrls.symbol as string,
    horizontal_svg_url: svgUrls.horizontal as string,
    vertical_svg_url: svgUrls.vertical as string,
    white_svg_url: svgUrls.white as string,
    black_svg_url: svgUrls.black as string,
    monochrome_svg_url: svgUrls.monochrome as string,
    print_pdf_url: printPdfUrl,
    brand_config_url: null,
  };
  const config = Buffer.from(JSON.stringify({
    schema_version: 1,
    brand_id: args.ownerId,
    brand_version_id: args.versionId,
    display_name: args.naming.displayName,
    descriptor: args.naming.descriptor,
    palette: args.palette,
    validation: args.validation,
    assets: { ...urls, profile_1024_url: profile1024Url, transparent_4096_url: transparent4096Url, favicon_svg_url: svgUrls.favicon },
  }, null, 2));
  urls.brand_config_url = await uploadGeneratedMedia({ bytes: config, mimeType: "application/json", pathPrefix: `${prefix}/brand-config` });
  return { urls, profile1024Url, transparent4096Url } satisfies UploadedBrandKit;
}

function pickBestOrientationUrl(urls: LogoCandidateUrls, detected: DetectedLogo | null) {
  if (detected?.lockupStructure?.orientation === "horizontal") return urls.horizontal_logo_url;
  if (detected?.lockupStructure?.orientation === "vertical") return urls.vertical_logo_url;
  return urls.primary_logo_url;
}

export async function analyzeBrandSource(admin: SupabaseClient, request: AnalyzeBrandSourceRequest): Promise<AnalyzeBrandSourceResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no está configurada.");
  const detectedLogo = request.referenceImages.length ? await detectLogoInReference({ apiKey, referenceImage: request.referenceImages[0] }) : EMPTY_DETECTED_LOGO;
  const brandAsset = await findActiveBrandAsset(admin, request.ownerType, request.ownerId);
  let officialNaming: { displayName: string; descriptor: string | null } | null = null;
  if (brandAsset?.active_version_id) {
    const official = await getBrandAssetVersion(admin, brandAsset.active_version_id);
    const naming = official?.generation_metadata?.naming;
    if (official?.status === "published" && naming) officialNaming = { displayName: naming.displayName, descriptor: naming.descriptor };
  }
  const naming = resolveBrandNaming({ entityName: request.entityName, detectedLogo, officialNaming });
  return { detectedLogo, naming, suggestedTypography: suggestTypography(detectedLogo) };
}

async function reuseOfficialAsset(args: { admin: SupabaseClient; request: LogoGenerationRequest; brandAsset: BrandAssetRow; publishedVersion: BrandAssetVersionRow }): Promise<ResolveBrandAssetResult> {
  const urls = urlsFromVersion(args.publishedVersion);
  const { data: job, error } = await args.admin.from("brand_generation_jobs").insert({
    owner_type: args.request.ownerType,
    owner_id: args.request.ownerId,
    status: "completed",
    source: args.request.source,
    identity_facts: args.request.facts,
    detected_logo: args.request.detectedLogo ?? {},
    result_brand_asset_version_id: args.publishedVersion.id,
    actual_cost_usd: 0,
    created_by: args.request.createdBy ?? null,
    completed_at: new Date().toISOString(),
  }).select("id").single();
  if (error) throw new Error(`No se pudo registrar el reuso: ${error.message}`);
  if (urls) urls.primary_logo_url = pickBestOrientationUrl(urls, args.request.detectedLogo ?? null);
  return {
    jobId: job.id as string,
    brandAssetId: args.brandAsset.id,
    brandAssetVersionId: args.publishedVersion.id,
    status: "reused_official",
    mode: args.publishedVersion.import_mode ?? "legacy_raster_import",
    urls,
    sourceReferenceUrl: args.publishedVersion.source_reference_url ?? null,
    reconstructionPreviewUrl: args.publishedVersion.reconstruction_preview_url ?? null,
    standaloneSymbolAvailable: Boolean(args.publishedVersion.standalone_symbol_available),
    clearance: null,
    detectedLogo: args.request.detectedLogo ?? null,
    naming: args.publishedVersion.generation_metadata?.naming ?? null,
    validation: args.publishedVersion.validation_report ?? null,
    costUsd: 0,
  };
}

async function createDraftVersion(args: {
  admin: SupabaseClient;
  brandAssetId: string;
  request: LogoGenerationRequest;
  detectedLogo: DetectedLogo;
  naming: BrandNaming;
  typography: TypographyConfig | null;
  mode: BrandImportMode;
  fingerprint: Awaited<ReturnType<typeof fingerprintLogo>>;
  clearance: BrandClearanceResult;
  validation: VectorValidationReport;
  reconstructionParams: unknown;
}) {
  const { data, error } = await args.admin.from("brand_asset_versions").insert({
    brand_asset_id: args.brandAssetId,
    source_type: args.request.source,
    source_mockup_url: args.request.referenceImageUrls?.[0] ?? null,
    palette: args.detectedLogo.visualSignature?.palette ?? [],
    visual_analysis: args.detectedLogo,
    decomposition: args.detectedLogo.decomposition,
    generation_metadata: { naming: args.naming, typography: args.typography, importMode: args.mode, vectorMaster: true },
    fingerprint: args.fingerprint,
    import_mode: args.mode,
    source_crop: args.detectedLogo.primaryBox,
    reconstruction_params: args.reconstructionParams,
    validation_report: args.validation,
    clearance_status: args.clearance.status,
    ownership_attested: args.request.ownershipAttested === true,
    ownership_attested_by: args.request.ownershipAttested === true ? args.request.ownershipAttestedBy ?? args.request.createdBy ?? null : null,
    ownership_attested_at: args.request.ownershipAttested === true ? new Date().toISOString() : null,
    source_kind: args.request.sourceKind ?? (args.mode === "owned_identity_reconstruction" ? "own_mockup" : "reference_only"),
    source_note: args.request.sourceNote ?? null,
    standalone_symbol_available: Boolean(args.detectedLogo.decomposition?.components.some((component) => component.kind === "symbol" && component.present)),
    status: "draft",
  }).select("id").single();
  if (error) throw new Error(`No se pudo guardar la versión vectorial: ${error.message}`);
  return data.id as string;
}

async function finalizeVersion(args: {
  admin: SupabaseClient;
  versionId: string;
  kit: BrandKitFiles;
  request: LogoGenerationRequest;
  naming: BrandNaming;
  validation: VectorValidationReport;
  sourceReferenceBytes?: Buffer | null;
  previewBytes: Buffer;
}) {
  const palette = args.request.detectedLogo?.visualSignature?.palette ?? [];
  const uploaded = await uploadBrandKit({ kit: args.kit, ownerType: args.request.ownerType, ownerId: args.request.ownerId, versionId: args.versionId, naming: args.naming, palette, validation: args.validation });
  const [sourceReferenceUrl, reconstructionPreviewUrl] = await Promise.all([
    args.sourceReferenceBytes ? uploadGeneratedMedia({ bytes: args.sourceReferenceBytes, mimeType: "image/png", pathPrefix: `public-identity/${args.request.ownerType}s/${args.request.ownerId}/brand-logo/${args.versionId}/source-reference` }) : Promise.resolve(null),
    uploadGeneratedMedia({ bytes: args.previewBytes, mimeType: "image/png", pathPrefix: `public-identity/${args.request.ownerType}s/${args.request.ownerId}/brand-logo/${args.versionId}/reconstruction-preview` }),
  ]);
  const { urls } = uploaded;
  const { error } = await args.admin.from("brand_asset_versions").update({
    primary_logo_url: urls.primary_logo_url,
    symbol_logo_url: urls.symbol_logo_url,
    horizontal_logo_url: urls.horizontal_logo_url,
    vertical_logo_url: urls.vertical_logo_url,
    square_logo_url: urls.square_logo_url,
    transparent_logo_url: urls.transparent_logo_url,
    white_logo_url: urls.white_logo_url,
    black_logo_url: urls.black_logo_url,
    favicon_url: urls.favicon_url,
    master_svg_url: urls.master_svg_url,
    symbol_svg_url: urls.symbol_svg_url,
    horizontal_svg_url: urls.horizontal_svg_url,
    vertical_svg_url: urls.vertical_svg_url,
    white_svg_url: urls.white_svg_url,
    black_svg_url: urls.black_svg_url,
    monochrome_svg_url: urls.monochrome_svg_url,
    print_pdf_url: urls.print_pdf_url,
    brand_config_url: urls.brand_config_url,
    source_reference_url: sourceReferenceUrl,
    reconstruction_preview_url: reconstructionPreviewUrl,
  }).eq("id", args.versionId);
  if (error) throw new Error(`No se pudieron vincular los archivos del Brand Kit: ${error.message}`);
  return { urls, sourceReferenceUrl, reconstructionPreviewUrl };
}

async function reconstructOwnedIdentity(args: { admin: SupabaseClient; request: LogoGenerationRequest; brandAsset: BrandAssetRow | null; detectedLogo: DetectedLogo; naming: BrandNaming }): Promise<ResolveBrandAssetResult> {
  if (!args.detectedLogo.primaryBox || !args.request.referenceImages.length) throw new Error("Falta el recorte confirmado del logo.");
  if (args.request.sourceKind === "reference_only") throw new Error("Una referencia ajena no puede reconstruirse como identidad propia. Usá Crear una identidad original.");
  if (args.request.ownershipAttested !== true) throw new Error("Confirmá que el logo pertenece a tu proyecto o que tenés autorización para reconstruirlo.");
  const { data: job, error: jobError } = await args.admin.from("brand_generation_jobs").insert({
    owner_type: args.request.ownerType,
    owner_id: args.request.ownerId,
    status: "reconstructing_vector",
    source: args.request.source,
    reference_image_urls: args.request.referenceImageUrls ?? [],
    identity_facts: args.request.facts,
    detected_logo: args.detectedLogo,
    actual_cost_usd: 0,
    created_by: args.request.createdBy ?? null,
  }).select("id").single();
  if (jobError) throw new Error(jobError.message);
  const jobId = job.id as string;
  try {
    const referenceBytes = Buffer.from(args.request.referenceImages[0].data, "base64");
    const reconstruction = await reconstructLogoVector({ referenceBytes, detectedLogo: args.detectedLogo, params: args.request.reconstructionParams });
    const fingerprint = await fingerprintLogo(reconstruction.previewPng);
    const clearance = await runBrandClearance({
      admin: args.admin,
      ownerType: args.request.ownerType,
      ownerId: args.request.ownerId,
      fingerprint,
      naming: args.naming,
      imageBytes: reconstruction.previewPng,
      categories: categoriesFromFacts(args.request.facts),
      country: countryFromFacts(args.request.facts),
    });
    const brandAsset = await ensureBrandAsset({ admin: args.admin, existing: args.brandAsset, ownerType: args.request.ownerType, ownerId: args.request.ownerId, name: args.naming.entityName, createdBy: args.request.createdBy ?? null });
    const versionId = await createDraftVersion({ admin: args.admin, brandAssetId: brandAsset.id, request: args.request, detectedLogo: args.detectedLogo, naming: args.naming, typography: null, mode: "owned_identity_reconstruction", fingerprint, clearance, validation: reconstruction.validation, reconstructionParams: reconstruction.params });
    const kit = await buildBrandKit({ reconstruction, naming: args.naming, brandAssetId: brandAsset.id, versionId, palette: args.detectedLogo.visualSignature?.palette ?? [] });
    const finalized = await finalizeVersion({ admin: args.admin, versionId, kit, request: args.request, naming: args.naming, validation: reconstruction.validation, sourceReferenceBytes: reconstruction.sourceCropPng, previewBytes: reconstruction.previewPng });
    const clearanceCheckId = await saveClearanceCheck({ admin: args.admin, versionId, ownerType: args.request.ownerType, ownerId: args.request.ownerId, clearance });
    await args.admin.from("brand_asset_versions").update({ clearance_check_id: clearanceCheckId }).eq("id", versionId);
    await args.admin.from("brand_generation_jobs").update({ status: "completed", result_brand_asset_version_id: versionId, actual_cost_usd: 0, completed_at: new Date().toISOString() }).eq("id", jobId);
    return { jobId, brandAssetId: brandAsset.id, brandAssetVersionId: versionId, status: "awaiting_review", mode: "owned_identity_reconstruction", urls: finalized.urls, sourceReferenceUrl: finalized.sourceReferenceUrl, reconstructionPreviewUrl: finalized.reconstructionPreviewUrl, standaloneSymbolAvailable: Boolean(reconstruction.symbolSvg), clearance, detectedLogo: args.detectedLogo, naming: args.naming, validation: reconstruction.validation, costUsd: 0 };
  } catch (error) {
    await args.admin.from("brand_generation_jobs").update({ status: "failed", error_message: error instanceof Error ? error.message : "Fallo reconstruyendo SVG.", completed_at: new Date().toISOString() }).eq("id", jobId);
    throw error;
  }
}

async function generateOriginalIdentity(args: { admin: SupabaseClient; request: LogoGenerationRequest; brandAsset: BrandAssetRow | null; detectedLogo: DetectedLogo; naming: BrandNaming; typography: TypographyConfig }): Promise<ResolveBrandAssetResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no está configurada.");
  const mode: BrandImportMode = args.request.forceRedesign ? "clouva_generated_redesign" : "standalone_creation";
  const { data: job, error: jobError } = await args.admin.from("brand_generation_jobs").insert({ owner_type: args.request.ownerType, owner_id: args.request.ownerId, status: "generating_candidates", source: args.request.source, reference_image_urls: args.request.referenceImageUrls ?? [], identity_facts: args.request.facts, detected_logo: args.detectedLogo, created_by: args.request.createdBy ?? null }).select("id").single();
  if (jobError) throw new Error(jobError.message);
  const jobId = job.id as string;
  try {
    const fidelity = args.request.referenceFidelity ?? (args.detectedLogo.detected ? "high" : "balanced");
    const generated = await generateMasterSymbol({ admin: args.admin, apiKey, prompt: buildMasterSymbolPrompt({ entityName: args.naming.entityName, detected: args.detectedLogo, fidelity }) });
    const svgs = await composeLogoLockupSvgs({ masterSymbolBytes: generated.bytes, naming: args.naming, typography: args.typography, lockupStructure: args.detectedLogo.lockupStructure });
    const validation: VectorValidationReport = { rasterSimilarity: 1, edgeSimilarity: 1, smallSizeLegible: true, monochromeValid: true, transparentBackground: true, nodeCount: (svgs.master.match(/[MLQ]/g)?.length ?? 0), warnings: [] };
    const brandAsset = await ensureBrandAsset({ admin: args.admin, existing: args.brandAsset, ownerType: args.request.ownerType, ownerId: args.request.ownerId, name: args.naming.entityName, createdBy: args.request.createdBy ?? null });
    const preliminaryKit = await buildBrandKitFromSvgs({ svgs: { master: svgs.primary, ...svgs }, naming: args.naming, brandAssetId: brandAsset.id, versionId: "pending", palette: args.detectedLogo.visualSignature?.palette ?? [], validation });
    const fingerprint = await fingerprintLogo(preliminaryKit.pngs.primary.bytes);
    const clearance = await runBrandClearance({ admin: args.admin, ownerType: args.request.ownerType, ownerId: args.request.ownerId, fingerprint, naming: args.naming, imageBytes: preliminaryKit.pngs.primary.bytes, categories: categoriesFromFacts(args.request.facts), country: countryFromFacts(args.request.facts) });
    const versionId = await createDraftVersion({ admin: args.admin, brandAssetId: brandAsset.id, request: args.request, detectedLogo: args.detectedLogo, naming: args.naming, typography: args.typography, mode, fingerprint, clearance, validation, reconstructionParams: { source: "generated_symbol_then_vectorized" } });
    const kit = await buildBrandKitFromSvgs({ svgs: { master: svgs.primary, ...svgs }, naming: args.naming, brandAssetId: brandAsset.id, versionId, palette: args.detectedLogo.visualSignature?.palette ?? [], validation });
    const finalized = await finalizeVersion({ admin: args.admin, versionId, kit, request: args.request, naming: args.naming, validation, previewBytes: kit.pngs.primary.bytes });
    const clearanceCheckId = await saveClearanceCheck({ admin: args.admin, versionId, ownerType: args.request.ownerType, ownerId: args.request.ownerId, clearance });
    await args.admin.from("brand_asset_versions").update({ clearance_check_id: clearanceCheckId }).eq("id", versionId);
    await args.admin.from("brand_generation_jobs").update({ status: "completed", result_brand_asset_version_id: versionId, actual_cost_usd: generated.costUsd, completed_at: new Date().toISOString() }).eq("id", jobId);
    return { jobId, brandAssetId: brandAsset.id, brandAssetVersionId: versionId, status: "awaiting_review", mode, urls: finalized.urls, sourceReferenceUrl: null, reconstructionPreviewUrl: finalized.reconstructionPreviewUrl, standaloneSymbolAvailable: true, clearance, detectedLogo: args.detectedLogo, naming: args.naming, validation, costUsd: generated.costUsd };
  } catch (error) {
    await args.admin.from("brand_generation_jobs").update({ status: "failed", error_message: error instanceof Error ? error.message : "Fallo generando identidad.", completed_at: new Date().toISOString() }).eq("id", jobId);
    throw error;
  }
}

export async function resolveBrandAsset(admin: SupabaseClient, request: LogoGenerationRequest): Promise<ResolveBrandAssetResult> {
  const brandAsset = await findActiveBrandAsset(admin, request.ownerType, request.ownerId);
  if (!request.forceRedesign && brandAsset?.active_version_id) {
    const published = await getBrandAssetVersion(admin, brandAsset.active_version_id);
    if (published?.status === "published") return reuseOfficialAsset({ admin, request, brandAsset, publishedVersion: published });
  }
  let detectedLogo = request.detectedLogo ?? null;
  let naming = request.naming ?? null;
  if (!detectedLogo || !naming) {
    const analyzed = await analyzeBrandSource(admin, { ownerType: request.ownerType, ownerId: request.ownerId, entityName: request.entityName, source: request.source, referenceImages: request.referenceImages });
    detectedLogo = detectedLogo ?? analyzed.detectedLogo;
    naming = naming ?? analyzed.naming;
  }
  if (request.referenceImages.length && request.forceRedesign !== true) return reconstructOwnedIdentity({ admin, request, brandAsset, detectedLogo, naming });
  return generateOriginalIdentity({ admin, request, brandAsset, detectedLogo, naming, typography: request.typography ?? suggestTypography(detectedLogo) });
}
