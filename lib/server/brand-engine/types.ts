// Tipos compartidos del CLOUVA Logo Engine.
//
// Regla principal V3:
// - importar identidad real conserva el activo seleccionado y NO llama a Gemini para crear imágenes;
// - rediseñar identidad es el único flujo que puede generar un símbolo nuevo;
// - ninguna identidad se publica sin titularidad declarada y clearance aprobado.

export const BRAND_OWNER_TYPES = ["player", "studio"] as const;
export type BrandOwnerType = (typeof BRAND_OWNER_TYPES)[number];

export const BRAND_SOURCE_TYPES = [
  "standalone",
  "website_mockup",
  "uploaded_logo",
  "sketch",
  "brand_reference",
  "identity_brief",
] as const;
export type BrandSourceType = (typeof BRAND_SOURCE_TYPES)[number];

export const BRAND_SOURCE_KINDS = ["own_logo_file", "own_mockup", "designer_delivery", "reference_only"] as const;
export type BrandSourceKind = (typeof BRAND_SOURCE_KINDS)[number];

export const BRAND_IMPORT_MODES = ["real_identity_import", "clouva_generated_redesign", "standalone_creation"] as const;
export type BrandImportMode = (typeof BRAND_IMPORT_MODES)[number];

export const EXTRACTION_METHODS = ["manual_crop", "confirmed_detected_crop"] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

export const BRAND_CLEARANCE_STATUSES = [
  "clear",
  "review_required",
  "blocked_internal_duplicate",
  "blocked_external_name_conflict",
  "blocked_external_visual_conflict",
  "blocked_combined_conflict",
  "external_check_unavailable",
] as const;
export type BrandClearanceStatus = (typeof BRAND_CLEARANCE_STATUSES)[number];

export const INTERNAL_CLEARANCE_STATUSES = ["internal_clear", "internal_review_required", "internal_blocked_duplicate"] as const;
export type InternalClearanceStatus = (typeof INTERNAL_CLEARANCE_STATUSES)[number];

export const LOGO_TYPES = ["symbol", "wordmark", "monogram", "combination", "emblem"] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

export const LOGO_COMPLEXITY = ["minimal", "medium", "detailed"] as const;
export type LogoComplexity = (typeof LOGO_COMPLEXITY)[number];

export const LOGO_OCCURRENCE_ROLES = ["primary_lockup", "symbol", "wordmark", "secondary_application"] as const;
export type LogoOccurrenceRole = (typeof LOGO_OCCURRENCE_ROLES)[number];

export const SYMBOL_POSITIONS = ["above", "left", "right", "integrated", "none"] as const;
export type SymbolPosition = (typeof SYMBOL_POSITIONS)[number];

export const NAME_POSITIONS = ["center", "left", "right"] as const;
export type NamePosition = (typeof NAME_POSITIONS)[number];

export const DESCRIPTOR_POSITIONS = ["below", "right", "integrated", "none"] as const;
export type DescriptorPosition = (typeof DESCRIPTOR_POSITIONS)[number];

export const LOCKUP_ORIENTATIONS = ["horizontal", "vertical", "stacked", "square"] as const;
export type LockupOrientation = (typeof LOCKUP_ORIENTATIONS)[number];

export const LETTER_SPACING_VALUES = ["tight", "normal", "wide", "very_wide"] as const;
export type LetterSpacing = (typeof LETTER_SPACING_VALUES)[number];

export type NormalizedBox = { top: number; left: number; bottom: number; right: number };

export type LogoOccurrence = { box: NormalizedBox; role: LogoOccurrenceRole; confidence: number };

export type LogoVisibleText = { primaryName: string | null; descriptor: string | null; otherText: string[] };

export type LogoLockupStructure = {
  symbolPosition: SymbolPosition;
  namePosition: NamePosition;
  descriptorPosition: DescriptorPosition;
  orientation: LockupOrientation;
  nameToDescriptorRatio: number;
  symbolToWordmarkRatio: number;
  letterSpacing: LetterSpacing;
};

export type LogoVisualSignature = {
  silhouette: string;
  geometry: string;
  symmetry: string;
  strokeWeight: string;
  negativeSpace: string;
  typographyStyle: string | null;
  palette: string[];
  complexity: LogoComplexity;
};

export type DetectedLogo = {
  detected: boolean;
  confidence: number;
  primaryBox: NormalizedBox | null;
  occurrences: LogoOccurrence[];
  logoType: LogoType | null;
  visibleText: LogoVisibleText;
  lockupStructure: LogoLockupStructure | null;
  visualSignature: LogoVisualSignature | null;
};

export type LogoFingerprint = {
  sha256: string;
  phash: string;
  normalizedSha256?: string;
  dhash?: string;
};

export const BRAND_NAMING_SOURCES = ["user_confirmed", "mockup_detected", "official_identity", "entity_fallback"] as const;
export type BrandNamingSource = (typeof BRAND_NAMING_SOURCES)[number];

export type BrandNaming = {
  entityName: string;
  displayName: string;
  descriptor: string | null;
  source: BrandNamingSource;
};

export const TYPOGRAPHY_WIDTHS = ["condensed", "normal", "extended"] as const;
export type TypographyWidth = (typeof TYPOGRAPHY_WIDTHS)[number];

export type TypographyConfig = {
  family: string;
  weight: number;
  width: TypographyWidth;
  uppercase: boolean;
  primaryTracking: number;
  descriptorTracking: number;
  descriptorScale: number;
};

export const REFERENCE_FIDELITY_LEVELS = ["creative", "balanced", "high"] as const;
export type ReferenceFidelity = (typeof REFERENCE_FIDELITY_LEVELS)[number];

export type LogoCandidateVariants = {
  primary: { bytes: Buffer; mimeType: string };
  symbol: { bytes: Buffer; mimeType: string };
  horizontal: { bytes: Buffer; mimeType: string };
  vertical: { bytes: Buffer; mimeType: string };
  square: { bytes: Buffer; mimeType: string };
  transparent: { bytes: Buffer; mimeType: string };
  white: { bytes: Buffer; mimeType: string };
  black: { bytes: Buffer; mimeType: string };
  favicon: { bytes: Buffer; mimeType: string };
};

export type LogoCandidateUrls = {
  primary_logo_url: string;
  symbol_logo_url: string;
  horizontal_logo_url: string;
  vertical_logo_url: string;
  square_logo_url: string;
  transparent_logo_url: string;
  white_logo_url: string;
  black_logo_url: string;
  favicon_url: string;
};

export type ImportedBrandMaster = {
  originalBytes: Buffer;
  cleanedBytes: Buffer;
  mimeType: "image/png";
  width: number;
  height: number;
  sourceImageUrl: string | null;
  sourceBox: NormalizedBox;
  extractionMethod: ExtractionMethod;
};

export type ImportedBrandParts = {
  fullLockup: Buffer;
  standaloneSymbol: Buffer | null;
  wordmark: Buffer | null;
};

export type InternalBrandMatch = {
  versionId: string;
  ownerType: BrandOwnerType;
  ownerId: string;
  similarity: number;
  reason: string;
};

export type ExternalBrandMatch = {
  source: string;
  reference: string;
  name: string | null;
  similarity: number;
  classOverlap: number;
  url: string | null;
};

export type BrandClearanceResult = {
  status: BrandClearanceStatus;
  internal: {
    checked: boolean;
    status: InternalClearanceStatus;
    highestSimilarity: number;
    conflictingOwnerId: string | null;
    conflictingVersionId: string | null;
    matches: InternalBrandMatch[];
  };
  external: {
    checked: boolean;
    status: "clear" | "review_required" | "blocked" | "external_check_unavailable";
    nameRisk: number;
    visualRisk: number;
    classOverlap: number;
    sourcesChecked: string[];
    matches: ExternalBrandMatch[];
  };
  decisionReasons: string[];
  checkedAt: string;
};

export type AnalyzeBrandSourceRequest = {
  ownerType: BrandOwnerType;
  ownerId: string;
  entityName: string;
  source: BrandSourceType;
  referenceImages: Array<{ mimeType: string; data: string }>;
};

export type AnalyzeBrandSourceResult = {
  detectedLogo: DetectedLogo;
  naming: BrandNaming;
  suggestedTypography: TypographyConfig;
};

export type LogoGenerationRequest = {
  ownerType: BrandOwnerType;
  ownerId: string;
  entityName: string;
  facts: Record<string, unknown>;
  source: BrandSourceType;
  referenceImages: Array<{ mimeType: string; data: string }>;
  referenceImageUrls?: string[];
  createdBy?: string | null;
  forceRedesign?: boolean;
  referenceFidelity?: ReferenceFidelity;
  detectedLogo?: DetectedLogo | null;
  naming?: BrandNaming | null;
  typography?: TypographyConfig | null;
  extractionMethod?: ExtractionMethod;
  ownershipAttested?: boolean;
  ownershipAttestedBy?: string | null;
  sourceKind?: BrandSourceKind;
  sourceNote?: string | null;
};

export type ResolveBrandAssetResult = {
  jobId: string;
  brandAssetId: string;
  brandAssetVersionId: string;
  status: "awaiting_review" | "reused_official";
  mode: BrandImportMode;
  urls: LogoCandidateUrls | null;
  originalAssetUrl: string | null;
  cleanedAssetUrl: string | null;
  standaloneSymbolAvailable: boolean;
  clearance: BrandClearanceResult | null;
  detectedLogo: DetectedLogo | null;
  naming: BrandNaming | null;
  costUsd: number;
};
