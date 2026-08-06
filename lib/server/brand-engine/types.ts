// Esquema del CLOUVA Logo Engine -- motor compartido entre el generador de
// páginas (process-job/route.ts) y la herramienta independiente /logo. Ver
// plan de esta sesión: nunca dos generadores de logo distintos, uno solo
// consumido de dos lugares.
//
// V2 (hotfix 2026-08-06): el V1 generaba 4 símbolos independientes con 4
// llamadas a Gemini -- perdía la estructura real del wordmark ("IGLÚ
// RECORDS" se convirtió en "EL IGLÚ" con un triángulo genérico). V2 separa
// "análisis" (qué dice y cómo está compuesto el logo real) de "generación"
// (un solo símbolo maestro) de "composición" (el wordmark se arma
// determinísticamente con una fuente real, nunca lo escribe Gemini).

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

// Caja 0-1000 relativa a la imagen COMPLETA -- mismo formato ya probado y
// documentado en lib/server/layout-config.ts (gotcha real: nunca porcentajes
// relativos a una sub-región, nunca array posicional).
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

// Resultado de analyze-logo-source.ts -- nunca contiene una URL ni bytes de
// imagen generados, solo la descripción/estructura/texto real que después
// alimenta build-logo-brief.ts (para el símbolo) y compose-logo-lockups.ts
// (para el wordmark). primaryBox es la caja del lockup completo; occurrences
// lista cada aparición del logo en el mockup (navbar/pared/portada/etc), útil
// para elegir la más clara como fuente del recorte real.
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

export type LogoFingerprint = { sha256: string; phash: string };

// Fase 3: nombre interno de CLOUVA vs. texto real mostrado en el logo --
// nunca se transforma uno en el otro automáticamente ("IGLÚ" no se convierte
// en "El Iglú" ni viceversa).
export const BRAND_NAMING_SOURCES = ["user_confirmed", "mockup_detected", "official_identity", "entity_fallback"] as const;
export type BrandNamingSource = (typeof BRAND_NAMING_SOURCES)[number];

export type BrandNaming = {
  entityName: string;
  displayName: string;
  descriptor: string | null;
  source: BrandNamingSource;
};

// Fase 5: el wordmark se compone determinísticamente (nunca lo escribe
// Gemini) -- family siempre "Archivo Black" en esta fase (única fuente
// embebida y verificada, ver lib/server/brand-engine/fonts/), el resto de
// los campos controla tracking/escala/mayúsculas por lockup.
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

// Fase 7: cuánto se apega la generación del símbolo maestro a la referencia
// real. "high" es el default para cualquier logo detectado en un mockup --
// nunca significa copiar el símbolo exacto, significa respetar composición/
// proporción/paleta/complejidad con más rigor.
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

// Paso 1 (barato, sin generar imágenes): analizar la referencia y proponer
// naming/estructura. /logo lo llama primero y deja que el usuario corrija
// antes de gastar una generación real (Fase 6).
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

// Paso 2: generar de verdad. Si detectedLogo/naming ya vienen (porque el
// caller ya pasó por analyzeBrandSource, con o sin ediciones del usuario),
// resolveBrandAsset NO vuelve a analizar -- los usa tal cual. El flujo
// automático de páginas (process-job/route.ts) nunca pasa por el paso de
// preview: llama analyzeBrandSource + resolveBrandAsset seguidos, sin
// intervención humana, igual que antes.
export type LogoGenerationRequest = {
  ownerType: BrandOwnerType;
  ownerId: string;
  // Nombre interno de la entidad en CLOUVA (players.display_name /
  // studios.name) -- fallback de BrandNaming si no hay nada mejor, nunca se
  // usa como texto del logo si el mockup detectó otro (Fase 3).
  entityName: string;
  facts: Record<string, unknown>;
  source: BrandSourceType;
  referenceImages: Array<{ mimeType: string; data: string }>;
  createdBy?: string | null;
  // Regla 1 (correción obligatoria): con un logo oficial ya `published`, un
  // mockup nuevo NUNCA rediseña el símbolo por defecto -- solo una acción
  // explícita "Rediseñar identidad" (únicamente disponible desde /logo,
  // NUNCA desde la generación automática de páginas) puede mandar esto en
  // true.
  forceRedesign?: boolean;
  referenceFidelity?: ReferenceFidelity;
  detectedLogo?: DetectedLogo | null;
  naming?: BrandNaming | null;
  typography?: TypographyConfig | null;
};

export type ResolveBrandAssetResult = {
  jobId: string;
  brandAssetId: string;
  brandAssetVersionId: string;
  status: "awaiting_review" | "reused_official";
  urls: LogoCandidateUrls | null;
  detectedLogo: DetectedLogo | null;
  naming: BrandNaming | null;
  costUsd: number;
};
