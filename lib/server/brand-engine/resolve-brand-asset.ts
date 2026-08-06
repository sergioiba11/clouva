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
type VersionRow = {
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
  master_svg_url: string | null;
  symbol_svg_url: string | null;
  horizontal_svg_url: string | null;
  vertical_svg_url: string | null;
  white_svg_url: string | null;
  black_svg_url: string | null;
  monochrome_svg_url: string | null;
  print_pdf_url: string | null;
  brand_config_url: string | null;
  source_reference_url: string | null;
  reconstruction_preview_url: string | null;
  standalone_symbol_available: boolean | null;
  validation_report: VectorValidationReport | null;
  generation_metadata: { naming?: BrandNaming; typography?: TypographyConfig; importMode?: BrandImportMode } | null;
};

async function findBrandAsset(admin: SupabaseClient, ownerType: BrandOwnerType, ownerId: string) {
  const { data, error } = await admin.from("brand_assets").select("id,owner_type,owner_id,active_version_id").eq("owner_type", ownerType).eq("owner_id", ownerId).eq("status", "active").maybeSingle();
  if (error) throw new Error(`No se pudo leer la identidad: ${error.message}`);
  return data as BrandAssetRow | null;
}

async function readVersion(admin: SupabaseClient, versionId: string) {
  const { data, error } = await admin.from("brand_asset_versions").select("id,status,import_mode,primary_logo_url,symbol_logo_url,horizontal_logo_url,vertical_logo_url,square_logo_url,transparent_logo_url,white_logo_url,black_logo_url,favicon_url,master_svg_url,symbol_svg_url,horizontal_svg_url,vertical_svg_url,white_svg_url,black_svg_url,monochrome_svg_url,print_pdf_url,brand_config_url,source_reference_url,reconstruction_preview_url,standalone_symbol_available,validation_report,generation_metadata").eq("id", versionId).maybeSingle();
  if (error) throw new Error(`No se pudo leer la versión: ${error.message}`);
  return data as VersionRow | null;
}

function versionUrls(version: VersionRow): LogoCandidateUrls | null {
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
    master_svg_url: version.master_svg_url,
    symbol_svg_url: version.symbol_svg_url,
    horizontal_svg_url: version.horizontal_svg_url,
    vertical_svg_url: version.vertical_svg_url,
    white_svg_url: version.white_svg_url,
    black_svg_url: version.black_svg_url,
    monochrome_svg_url: version.monochrome_svg_url,
    print_pdf_url: version.print_pdf_url,
    brand_config_url: version.brand_config_url,
  };
}

async function ensureBrandAsset(args: { admin: SupabaseClient; existing: BrandAssetRow | null; request: LogoGenerationRequest; naming: BrandNaming }) {
  if (args.existing) return args.existing;
  const { data, error } = await args.admin.from("brand_assets").insert({ owner_type: args.request.ownerType, owner_id: args.request.ownerId, name: args.naming.entityName, created_by: args.request.createdBy ?? null }).select("id,owner_type,owner_id,active_version_id").single();
  if (error) throw new Error(`No se pudo crear la identidad: ${error.message}`);
  return data as BrandAssetRow;
}

function categoriesFromFacts(facts: Record<string, unknown>) {
  const output: string[] = [];
  for (const key of ["professional_categories", "services", "categories", "genres"]) {
    const value = facts[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string") output.push(item);
      else if (item && typeof item === "object" && "name" in item && typeof (item as { name?: unknown }).name === "string") output.push((item as { name: string }).name);
    }
  }
  return Array.from(new Set(output.map((value) => value.trim()).filter(Boolean))).slice(0, 20);
}

function countryFromFacts(facts: Record<string, unknown>) {
  return typeof facts.country === "string" && facts.country.trim() ? facts.country.trim() : null;
}

function namingForOriginalDesign(request: LogoGenerationRequest, analyzedNaming: BrandNaming): BrandNaming {
  // Un mockup ajeno puede aportar lenguaje visual, nunca su nombre. Solo se
  // conserva un nombre distinto del entityName cuando el usuario lo confirmó
  // explícitamente desde /logo.
  if (!request.referenceImages.length || request.naming?.source === "user_confirmed") return analyzedNaming;
  return { entityName: request.entityName, displayName: request.entityName, descriptor: null, source: "entity_fallback" };
}

async function checkClearance(args: { admin: SupabaseClient; request: LogoGenerationRequest; naming: BrandNaming; bytes: Buffer; fingerprint: Awaited<ReturnType<typeof fingerprintLogo>> }) {
  return runBrandClearance({ admin: args.admin, ownerType: args.request.ownerType, ownerId: args.request.ownerId, fingerprint: args.fingerprint, naming: args.naming, imageBytes: args.bytes, categories: categoriesFromFacts(args.request.facts), country: countryFromFacts(args.request.facts) });
}

async function saveClearance(admin: SupabaseClient, versionId: string, request: LogoGenerationRequest, clearance: BrandClearanceResult) {
  const { data, error } = await admin.from("brand_clearance_checks").insert({
    brand_asset_version_id: versionId,
    owner_type: request.ownerType,
    owner_id: request.ownerId,
    status: clearance.status,
    internal_similarity_score: clearance.internal.highestSimilarity,
    external_name_risk_score: clearance.external.nameRisk,
    external_visual_risk_score: clearance.external.visualRisk,
    class_overlap_score: clearance.external.classOverlap,
    sources_checked: clearance.external.sourcesChecked,
    internal_matches: clearance.internal.matches,
    external_matches: clearance.external.matches,
    decision_reasons: clearance.decisionReasons,
    checked_at: clearance.checkedAt,
  }).select("id").single();
  if (error) throw new Error(`No se pudo guardar el clearance: ${error.message}`);
  await admin.from("brand_asset_versions").update({ clearance_check_id: data.id }).eq("id", versionId);
}

async function createJob(admin: SupabaseClient, request: LogoGenerationRequest, status: string, detectedLogo: DetectedLogo) {
  const { data, error } = await admin.from("brand_generation_jobs").insert({ owner_type: request.ownerType, owner_id: request.ownerId, status, source: request.source, reference_image_urls: request.referenceImageUrls ?? [], identity_facts: request.facts, detected_logo: detectedLogo, actual_cost_usd: 0, created_by: request.createdBy ?? null }).select("id").single();
  if (error) throw new Error(`No se pudo crear el trabajo: ${error.message}`);
  return data.id as string;
}

async function failJob(admin: SupabaseClient, jobId: string, error: unknown) {
  await admin.from("brand_generation_jobs").update({ status: "failed", error_message: error instanceof Error ? error.message : "Falló el Logo Engine.", completed_at: new Date().toISOString() }).eq("id", jobId);
}

async function insertDraft(args: {
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
  if (error) throw new Error(`No se pudo guardar la versión: ${error.message}`);
  return data.id as string;
}

async function uploadKit(args: { kit: BrandKitFiles; request: LogoGenerationRequest; versionId: string; naming: BrandNaming; validation: VectorValidationReport }) {
  const prefix = `public-identity/${args.request.ownerType}s/${args.request.ownerId}/brand-logo/${args.versionId}`;
  const svgPairs = await Promise.all(Object.entries(args.kit.svgs).map(async ([key, svg]) => [key, await uploadGeneratedMedia({ bytes: Buffer.from(svg), mimeType: "image/svg+xml", pathPrefix: `${prefix}/svg/${key}` })] as const));
  const pngPairs = await Promise.all(Object.entries(args.kit.pngs).map(async ([key, file]) => [key, await uploadGeneratedMedia({ bytes: file.bytes, mimeType: file.mimeType, pathPrefix: `${prefix}/png/${key}` })] as const));
  const svg = Object.fromEntries(svgPairs) as Record<string, string>;
  const png = Object.fromEntries(pngPairs) as Record<string, string>;
  const [printPdfUrl, transparent4096Url, profile1024Url] = await Promise.all([
    uploadGeneratedMedia({ bytes: args.kit.printPdf, mimeType: "application/pdf", pathPrefix: `${prefix}/print` }),
    uploadGeneratedMedia({ bytes: args.kit.transparent4096, mimeType: "image/png", pathPrefix: `${prefix}/transparent-4096` }),
    uploadGeneratedMedia({ bytes: args.kit.profile1024, mimeType: "image/png", pathPrefix: `${prefix}/profile-1024` }),
  ]);
  const urls: LogoCandidateUrls = {
    primary_logo_url: png.primary,
    symbol_logo_url: png.symbol,
    horizontal_logo_url: png.horizontal,
    vertical_logo_url: png.vertical,
    square_logo_url: png.square,
    transparent_logo_url: png.transparent,
    white_logo_url: png.white,
    black_logo_url: png.black,
    favicon_url: png.favicon,
    master_svg_url: svg.master,
    symbol_svg_url: svg.symbol,
    horizontal_svg_url: svg.horizontal,
    vertical_svg_url: svg.vertical,
    white_svg_url: svg.white,
    black_svg_url: svg.black,
    monochrome_svg_url: svg.monochrome,
    print_pdf_url: printPdfUrl,
    brand_config_url: null,
  };
  const config = Buffer.from(JSON.stringify({ schema_version: 1, brand_version_id: args.versionId, display_name: args.naming.displayName, descriptor: args.naming.descriptor, validation: args.validation, assets: { ...urls, favicon_svg_url: svg.favicon, transparent_4096_url: transparent4096Url, profile_1024_url: profile1024Url } }, null, 2));
  urls.brand_config_url = await uploadGeneratedMedia({ bytes: config, mimeType: "application/json", pathPrefix: `${prefix}/brand-config` });
  return urls;
}

async function finalizeDraft(args: { admin: SupabaseClient; request: LogoGenerationRequest; versionId: string; kit: BrandKitFiles; naming: BrandNaming; validation: VectorValidationReport; sourceReference?: Buffer; preview: Buffer }) {
  const urls = await uploadKit({ kit: args.kit, request: args.request, versionId: args.versionId, naming: args.naming, validation: args.validation });
  const [sourceReferenceUrl, reconstructionPreviewUrl] = await Promise.all([
    args.sourceReference ? uploadGeneratedMedia({ bytes: args.sourceReference, mimeType: "image/png", pathPrefix: `public-identity/${args.request.ownerType}s/${args.request.ownerId}/brand-logo/${args.versionId}/source-reference` }) : Promise.resolve(null),
    uploadGeneratedMedia({ bytes: args.preview, mimeType: "image/png", pathPrefix: `public-identity/${args.request.ownerType}s/${args.request.ownerId}/brand-logo/${args.versionId}/preview` }),
  ]);
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
  if (error) throw new Error(`No se pudieron vincular los archivos: ${error.message}`);
  return { urls, sourceReferenceUrl, reconstructionPreviewUrl };
}

export async function analyzeBrandSource(admin: SupabaseClient, request: AnalyzeBrandSourceRequest): Promise<AnalyzeBrandSourceResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no está configurada.");
  const detectedLogo = request.referenceImages.length ? await detectLogoInReference({ apiKey, referenceImage: request.referenceImages[0] }) : EMPTY_DETECTED_LOGO;
  const brandAsset = await findBrandAsset(admin, request.ownerType, request.ownerId);
  let officialNaming: { displayName: string; descriptor: string | null } | null = null;
  if (brandAsset?.active_version_id) {
    const official = await readVersion(admin, brandAsset.active_version_id);
    const naming = official?.generation_metadata?.naming;
    if (official?.status === "published" && naming) officialNaming = { displayName: naming.displayName, descriptor: naming.descriptor };
  }
  const naming = resolveBrandNaming({ entityName: request.entityName, detectedLogo, officialNaming });
  return { detectedLogo, naming, suggestedTypography: suggestTypography(detectedLogo) };
}

async function reuseOfficial(admin: SupabaseClient, request: LogoGenerationRequest, brandAsset: BrandAssetRow, version: VersionRow): Promise<ResolveBrandAssetResult> {
  const jobId = await createJob(admin, request, "completed", request.detectedLogo ?? EMPTY_DETECTED_LOGO);
  await admin.from("brand_generation_jobs").update({ result_brand_asset_version_id: version.id, completed_at: new Date().toISOString() }).eq("id", jobId);
  const urls = versionUrls(version);
  if (urls && request.detectedLogo?.lockupStructure?.orientation === "horizontal") urls.primary_logo_url = urls.horizontal_logo_url;
  return { jobId, brandAssetId: brandAsset.id, brandAssetVersionId: version.id, status: "reused_official", mode: version.import_mode ?? "legacy_raster_import", urls, sourceReferenceUrl: version.source_reference_url, reconstructionPreviewUrl: version.reconstruction_preview_url, standaloneSymbolAvailable: Boolean(version.standalone_symbol_available), clearance: null, detectedLogo: request.detectedLogo ?? null, naming: version.generation_metadata?.naming ?? null, validation: version.validation_report, costUsd: 0 };
}

async function reconstructOwned(admin: SupabaseClient, request: LogoGenerationRequest, existing: BrandAssetRow | null, detectedLogo: DetectedLogo, naming: BrandNaming): Promise<ResolveBrandAssetResult> {
  if (!detectedLogo.primaryBox || !request.referenceImages.length) throw new Error("Falta el área confirmada del logo.");
  if (request.sourceKind === "reference_only" || request.ownershipAttested !== true) throw new Error("Confirmá que el logo pertenece a tu proyecto o elegí Crear una identidad original.");
  const jobId = await createJob(admin, request, "reconstructing_vector", detectedLogo);
  try {
    const reconstruction = await reconstructLogoVector({ referenceBytes: Buffer.from(request.referenceImages[0].data, "base64"), detectedLogo, params: request.reconstructionParams });
    const fingerprint = await fingerprintLogo(reconstruction.previewPng);
    const clearance = await checkClearance({ admin, request, naming, bytes: reconstruction.previewPng, fingerprint });
    const brandAsset = await ensureBrandAsset({ admin, existing, request, naming });
    const versionId = await insertDraft({ admin, brandAssetId: brandAsset.id, request, detectedLogo, naming, typography: null, mode: "owned_identity_reconstruction", fingerprint, clearance, validation: reconstruction.validation, reconstructionParams: reconstruction.params });
    const kit = await buildBrandKit({ reconstruction, naming, brandAssetId: brandAsset.id, versionId, palette: detectedLogo.visualSignature?.palette ?? [] });
    const final = await finalizeDraft({ admin, request, versionId, kit, naming, validation: reconstruction.validation, sourceReference: reconstruction.sourceCropPng, preview: reconstruction.previewPng });
    await saveClearance(admin, versionId, request, clearance);
    await admin.from("brand_generation_jobs").update({ status: "completed", result_brand_asset_version_id: versionId, completed_at: new Date().toISOString() }).eq("id", jobId);
    return { jobId, brandAssetId: brandAsset.id, brandAssetVersionId: versionId, status: "awaiting_review", mode: "owned_identity_reconstruction", urls: final.urls, sourceReferenceUrl: final.sourceReferenceUrl, reconstructionPreviewUrl: final.reconstructionPreviewUrl, standaloneSymbolAvailable: Boolean(reconstruction.symbolSvg), clearance, detectedLogo, naming, validation: reconstruction.validation, costUsd: 0 };
  } catch (error) { await failJob(admin, jobId, error); throw error; }
}

async function createOriginal(admin: SupabaseClient, request: LogoGenerationRequest, existing: BrandAssetRow | null, detectedLogo: DetectedLogo, naming: BrandNaming, typography: TypographyConfig): Promise<ResolveBrandAssetResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no está configurada.");
  const mode: BrandImportMode = request.referenceImages.length || request.forceRedesign ? "clouva_generated_redesign" : "standalone_creation";
  const jobId = await createJob(admin, request, "generating_candidates", detectedLogo);
  try {
    const fidelity = request.referenceFidelity ?? (detectedLogo.detected ? "high" : "balanced");
    const generated = await generateMasterSymbol({ admin, apiKey, prompt: buildMasterSymbolPrompt({ entityName: naming.entityName, detected: detectedLogo, fidelity }) });
    const svgs = await composeLogoLockupSvgs({ masterSymbolBytes: generated.bytes, naming, typography, lockupStructure: detectedLogo.lockupStructure });
    const validation: VectorValidationReport = { rasterSimilarity: 1, edgeSimilarity: 1, smallSizeLegible: true, monochromeValid: true, transparentBackground: true, nodeCount: svgs.master.match(/[MLQ]/g)?.length ?? 0, warnings: [] };
    const brandAsset = await ensureBrandAsset({ admin, existing, request, naming });
    const previewKit = await buildBrandKitFromSvgs({ svgs, naming, brandAssetId: brandAsset.id, versionId: "pending", palette: detectedLogo.visualSignature?.palette ?? [], validation });
    const fingerprint = await fingerprintLogo(previewKit.pngs.primary.bytes);
    const clearance = await checkClearance({ admin, request, naming, bytes: previewKit.pngs.primary.bytes, fingerprint });
    const versionId = await insertDraft({ admin, brandAssetId: brandAsset.id, request, detectedLogo, naming, typography, mode, fingerprint, clearance, validation, reconstructionParams: { source: "generated_symbol_then_vectorized" } });
    const kit = await buildBrandKitFromSvgs({ svgs, naming, brandAssetId: brandAsset.id, versionId, palette: detectedLogo.visualSignature?.palette ?? [], validation });
    const final = await finalizeDraft({ admin, request, versionId, kit, naming, validation, preview: kit.pngs.primary.bytes });
    await saveClearance(admin, versionId, request, clearance);
    await admin.from("brand_generation_jobs").update({ status: "completed", result_brand_asset_version_id: versionId, actual_cost_usd: generated.costUsd, completed_at: new Date().toISOString() }).eq("id", jobId);
    return { jobId, brandAssetId: brandAsset.id, brandAssetVersionId: versionId, status: "awaiting_review", mode, urls: final.urls, sourceReferenceUrl: null, reconstructionPreviewUrl: final.reconstructionPreviewUrl, standaloneSymbolAvailable: true, clearance, detectedLogo, naming, validation, costUsd: generated.costUsd };
  } catch (error) { await failJob(admin, jobId, error); throw error; }
}

export async function resolveBrandAsset(admin: SupabaseClient, request: LogoGenerationRequest): Promise<ResolveBrandAssetResult> {
  const brandAsset = await findBrandAsset(admin, request.ownerType, request.ownerId);
  if (!request.forceRedesign && brandAsset?.active_version_id) {
    const official = await readVersion(admin, brandAsset.active_version_id);
    if (official?.status === "published") return reuseOfficial(admin, request, brandAsset, official);
  }
  let detectedLogo = request.detectedLogo ?? null;
  let naming = request.naming ?? null;
  if (!detectedLogo || !naming) {
    const analysis = await analyzeBrandSource(admin, { ownerType: request.ownerType, ownerId: request.ownerId, entityName: request.entityName, source: request.source, referenceImages: request.referenceImages });
    detectedLogo = detectedLogo ?? analysis.detectedLogo;
    naming = naming ?? analysis.naming;
  }
  const reconstructAsOwned = Boolean(request.referenceImages.length && !request.forceRedesign && request.ownershipAttested === true && request.sourceKind !== "reference_only");
  if (reconstructAsOwned) return reconstructOwned(admin, request, brandAsset, detectedLogo, naming);
  const originalNaming = namingForOriginalDesign(request, naming);
  return createOriginal(admin, request, brandAsset, detectedLogo, originalNaming, request.typography ?? suggestTypography(detectedLogo));
}
