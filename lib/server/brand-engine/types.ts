// Esquema del CLOUVA Logo Engine -- motor compartido entre el generador de
// páginas (process-job/route.ts) y la herramienta independiente /logo. Ver
// plan de esta sesión: nunca dos generadores de logo distintos, uno solo
// consumido de dos lugares.

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

export const LOGO_TYPES = ["isotype", "wordmark", "monogram", "combination", "emblem", "symbol"] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

export const LOGO_ORIENTATIONS = ["square", "horizontal", "vertical"] as const;
export type LogoOrientation = (typeof LOGO_ORIENTATIONS)[number];

export const LOGO_COMPLEXITY = ["minimal", "medium", "detailed"] as const;
export type LogoComplexity = (typeof LOGO_COMPLEXITY)[number];

// Caja 0-1000 relativa a la imagen COMPLETA -- mismo formato ya probado y
// documentado en lib/server/layout-config.ts (gotcha real: nunca porcentajes
// relativos a una sub-región, nunca array posicional).
export type NormalizedBox = { top: number; left: number; bottom: number; right: number };

export type LogoVisualSignature = {
  silhouette: string;
  geometry: string;
  symmetry: string;
  strokeWeight: string;
  negativeSpace: string;
  typographyStyle: string | null;
  palette: string[];
  orientation: LogoOrientation;
  complexity: LogoComplexity;
};

// Resultado de analyze-logo-source.ts -- nunca contiene una URL ni bytes de
// imagen, solo la descripción textual/geométrica que después alimenta el
// prompt de generación (build-logo-brief.ts). El recorte real de la región
// del logo se hace aparte, en Node, contra el box acá devuelto.
export type DetectedLogo = {
  detected: boolean;
  confidence: number;
  box: NormalizedBox | null;
  logoType: LogoType | null;
  visualSignature: LogoVisualSignature | null;
};

export type LogoFingerprint = { sha256: string; phash: string };

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

export type LogoGenerationRequest = {
  ownerType: BrandOwnerType;
  ownerId: string;
  name: string; // nombre real exacto -- nunca inventado, nunca el de la referencia
  facts: Record<string, unknown>; // playerBriefToFacts/studioBriefToFacts, ya existentes
  source: BrandSourceType;
  referenceImages: Array<{ mimeType: string; data: string }>; // GeminiReferenceImage
  createdBy?: string | null;
  // Regla 1 (correción obligatoria): con un logo oficial ya `published`, un
  // mockup nuevo NUNCA rediseña el símbolo por defecto -- solo una acción
  // explícita "Rediseñar identidad" (únicamente disponible desde /logo,
  // NUNCA desde la generación automática de páginas) puede mandar esto en
  // true.
  forceRedesign?: boolean;
};

export type ResolveBrandAssetResult = {
  jobId: string;
  brandAssetId: string;
  brandAssetVersionId: string;
  status: "awaiting_review" | "reused_official";
  urls: LogoCandidateUrls | null;
  detectedLogo: DetectedLogo | null;
  costUsd: number;
};
