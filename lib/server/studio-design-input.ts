import "server-only";

export type StudioDesignInput = {
  mockupImages: string[];
  themeImages: string[];
  realPhotos: string[];
  logoImages: string[];
  creativeDirection: string | null;
  logoOwnershipConfirmed: boolean;
};

export type StudioDesignMode = "reference_layout" | "adaptive_layout";
export type StudioDesignImageRole = "mockup" | "theme" | "photo" | "logo";

const REFERENCE_IMAGE_URL_RE = /^https:\/\/storage\.googleapis\.com\/[a-z0-9._-]+\/reference-images\/studios\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpe?g|webp)$/i;
const MAX_PER_ROLE = 3;
const MAX_TOTAL_IMAGES = 10;
const MAX_CREATIVE_DIRECTION = 280;

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function sanitizeUrls(value: unknown, max = MAX_PER_ROLE) {
  if (!Array.isArray(value)) return [];
  return unique(
    value.filter((item): item is string => typeof item === "string" && REFERENCE_IMAGE_URL_RE.test(item)),
  ).slice(0, max);
}

function sanitizeDirection(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim().slice(0, MAX_CREATIVE_DIRECTION);
  return cleaned || null;
}

export function sanitizeStudioDesignInput(value: unknown, legacyReferenceImageUrls: unknown = []): StudioDesignInput {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const explicitMockups = sanitizeUrls(raw.mockupImages);
  const legacyMockups = explicitMockups.length ? [] : sanitizeUrls(legacyReferenceImageUrls);
  const logoImages = sanitizeUrls(raw.logoImages, 1);
  const themeImages = sanitizeUrls(raw.themeImages);
  const realPhotos = sanitizeUrls(raw.realPhotos);

  const combined = unique([...explicitMockups, ...legacyMockups, ...logoImages, ...themeImages, ...realPhotos]).slice(0, MAX_TOTAL_IMAGES);
  const allowed = new Set(combined);
  const keep = (items: string[]) => items.filter((url) => allowed.has(url));

  return {
    mockupImages: keep([...explicitMockups, ...legacyMockups]),
    themeImages: keep(themeImages),
    realPhotos: keep(realPhotos),
    logoImages: keep(logoImages),
    creativeDirection: sanitizeDirection(raw.creativeDirection),
    logoOwnershipConfirmed: raw.logoOwnershipConfirmed === true,
  };
}

export function flattenStudioDesignInput(input: StudioDesignInput) {
  return unique([
    ...input.mockupImages,
    ...input.logoImages,
    ...input.themeImages,
    ...input.realPhotos,
  ]).slice(0, MAX_TOTAL_IMAGES);
}

export function resolveStudioDesignMode(input: StudioDesignInput): StudioDesignMode {
  return input.mockupImages.length ? "reference_layout" : "adaptive_layout";
}

export function hasStudioCreativeSource(input: StudioDesignInput) {
  return Boolean(
    input.mockupImages.length
    || input.logoImages.length
    || input.themeImages.length
    || input.creativeDirection,
  );
}

export function validateStudioDesignInput(input: StudioDesignInput) {
  if (!hasStudioCreativeSource(input)) {
    throw new Error("Agregá un mockup, un logo, una imagen de inspiración o escribí al menos una palabra sobre el estilo que querés.");
  }
  if (input.logoImages.length && !input.logoOwnershipConfirmed) {
    throw new Error("Confirmá que el logo pertenece a tu Studio o que estás autorizado a usarlo.");
  }
}

export function designInputFromSnapshot(sourceSnapshot: unknown, fallbackReferenceImageUrls: unknown = []): StudioDesignInput {
  const snapshot = sourceSnapshot && typeof sourceSnapshot === "object" ? sourceSnapshot as Record<string, unknown> : {};
  return sanitizeStudioDesignInput(snapshot.studio_design_input, fallbackReferenceImageUrls);
}

export function withStudioDesignInputSnapshot(sourceSnapshot: unknown, input: StudioDesignInput) {
  const snapshot = sourceSnapshot && typeof sourceSnapshot === "object" ? sourceSnapshot as Record<string, unknown> : {};
  return { ...snapshot, studio_design_input: input };
}

export function orderedStudioDesignImages(input: StudioDesignInput) {
  const rows: Array<{ url: string; role: StudioDesignImageRole }> = [];
  for (const url of input.mockupImages) rows.push({ url, role: "mockup" });
  for (const url of input.logoImages) rows.push({ url, role: "logo" });
  for (const url of input.themeImages) rows.push({ url, role: "theme" });
  for (const url of input.realPhotos) rows.push({ url, role: "photo" });
  return rows;
}
