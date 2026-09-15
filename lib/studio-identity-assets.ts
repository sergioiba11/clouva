export type IdentityAssetSource = "published" | "draft" | "subject";

export type IdentityAsset = {
  kind: string;
  url: string;
  source: IdentityAssetSource;
  brandAssetVersionId?: string | null;
};

type IdentityVersionLike = {
  asset_references?: unknown;
  layout_config?: unknown;
  brand_asset_version_id?: string | null;
} | null | undefined;

type ResolveIdentityAssetStateArgs = {
  publishedVersion: IdentityVersionLike;
  draftVersion: IdentityVersionLike;
  subjectLogoUrl?: string | null;
};

type VisualUrl = { url: string; kind: string };

const VISUAL_ASSET_RE = /\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
const KNOWN_MEDIA_HOST_RE = /^https:\/\/(?:storage\.googleapis\.com\/|[^/]+\.supabase\.co\/storage\/v1\/object\/)/i;
const IMAGE_SLOT_KEY_RE = /^(?:imageSlot|image_slot|imageSlotKey|image_slot_key)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isVisualAssetUrl(value: string): boolean {
  if (!/^https:\/\//i.test(value)) return false;
  return VISUAL_ASSET_RE.test(value) || KNOWN_MEDIA_HOST_RE.test(value);
}

function normalizeKind(value: unknown): string {
  if (typeof value !== "string") return "other";
  const kind = value.trim().toLowerCase().replace(/_/g, "-");
  if (!kind) return "other";
  if (kind === "hero-background" || kind === "hero-bg") return "hero";
  if (kind === "bg") return "background";
  if (kind.startsWith("pillar")) return "gallery";
  return kind;
}

function inferKindFromPath(path: string): string {
  const normalized = path.toLowerCase();
  if (normalized.includes("logo") || normalized.includes("brandmark")) return "logo";
  if (normalized.includes("cover")) return "cover";
  if (normalized.includes("hero")) return "hero";
  if (normalized.includes("background") || /(^|[.\[\]_-])bg([.\[\]_-]|$)/.test(normalized)) return "background";
  if (normalized.includes("texture")) return "texture";
  if (normalized.includes("favicon") || normalized.includes("icon")) return "icon";
  if (normalized.includes("gallery") || normalized.includes("photo") || normalized.includes("pillar") || normalized.includes("image")) return "gallery";
  return "other";
}

function collectDirectLayoutVisualUrls(value: unknown, path = "layout", output: VisualUrl[] = []): VisualUrl[] {
  if (typeof value === "string") {
    if (isVisualAssetUrl(value)) output.push({ url: value, kind: inferKindFromPath(path) });
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectDirectLayoutVisualUrls(item, `${path}[${index}]`, output));
    return output;
  }
  if (!isRecord(value)) return output;
  Object.entries(value).forEach(([key, item]) => {
    // image_slots is an address book. It is not proof that every slot was
    // rendered, so slot URLs are added separately only when a section points
    // at them (or as a compatibility fallback for older template layouts).
    if (path === "layout" && key === "image_slots") return;
    collectDirectLayoutVisualUrls(item, `${path}.${key}`, output);
  });
  return output;
}

function readImageSlots(layoutConfig: unknown): Record<string, string> {
  if (!isRecord(layoutConfig) || !isRecord(layoutConfig.image_slots)) return {};
  const slots: Record<string, string> = {};
  for (const [key, value] of Object.entries(layoutConfig.image_slots)) {
    if (typeof value === "string" && isVisualAssetUrl(value)) slots[key] = value;
  }
  return slots;
}

function collectReferencedImageSlotNames(value: unknown, output = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectReferencedImageSlotNames(item, output));
    return output;
  }
  if (!isRecord(value)) return output;
  for (const [key, item] of Object.entries(value)) {
    if (key === "image_slots") continue;
    if (IMAGE_SLOT_KEY_RE.test(key) && typeof item === "string" && item.trim()) output.add(item.trim());
    collectReferencedImageSlotNames(item, output);
  }
  return output;
}

function collectLayoutVisualUrls(layoutConfig: unknown): VisualUrl[] {
  const output = collectDirectLayoutVisualUrls(layoutConfig);
  const imageSlots = readImageSlots(layoutConfig);
  const referencedSlots = collectReferencedImageSlotNames(layoutConfig);

  if (referencedSlots.size > 0) {
    for (const slotName of referencedSlots) {
      const url = imageSlots[slotName];
      if (url) output.push({ url, kind: normalizeKind(slotName) });
    }
  } else if (output.length === 0) {
    // Compatibility for older template layouts where the renderer consumes
    // conventional slots implicitly rather than storing imageSlot references.
    for (const [slotName, url] of Object.entries(imageSlots)) output.push({ url, kind: normalizeKind(slotName) });
  }

  return output;
}

function readAssetReferences(value: unknown): VisualUrl[] {
  if (!Array.isArray(value)) return [];
  const assets: VisualUrl[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.url !== "string" || !isVisualAssetUrl(item.url)) continue;
    assets.push({ url: item.url, kind: normalizeKind(item.kind) });
  }
  return assets;
}

function preferKind(current: string, incoming: string): string {
  if (current === "other" && incoming !== "other") return incoming;
  if (current === "gallery" && !["other", "gallery"].includes(incoming)) return incoming;
  return current;
}

/**
 * Resolves only assets that are actually used by the renderer configuration.
 * asset_references contributes canonical semantic kinds, while layout_config
 * proves usage. Older identities that predate explicit imageSlot references are
 * supported by direct layout URLs and a conservative image_slots fallback.
 */
export function collectUsedIdentityAssets(version: IdentityVersionLike, source: Exclude<IdentityAssetSource, "subject">): IdentityAsset[] {
  if (!version) return [];
  const layoutAssets = collectLayoutVisualUrls(version.layout_config);
  const layoutUrls = new Set(layoutAssets.map((asset) => asset.url));
  const references = readAssetReferences(version.asset_references);
  const usedReferences = layoutUrls.size > 0
    ? references.filter((asset) => layoutUrls.has(asset.url))
    : references;

  const byUrl = new Map<string, IdentityAsset>();
  for (const asset of layoutAssets) {
    byUrl.set(asset.url, {
      kind: asset.kind,
      url: asset.url,
      source,
      brandAssetVersionId: asset.kind === "logo" ? version.brand_asset_version_id ?? null : undefined,
    });
  }
  for (const asset of usedReferences) {
    const current = byUrl.get(asset.url);
    if (current) {
      current.kind = preferKind(current.kind, asset.kind);
      if (current.kind === "logo") current.brandAssetVersionId = version.brand_asset_version_id ?? null;
      continue;
    }
    byUrl.set(asset.url, {
      kind: asset.kind,
      url: asset.url,
      source,
      brandAssetVersionId: asset.kind === "logo" ? version.brand_asset_version_id ?? null : undefined,
    });
  }
  return [...byUrl.values()];
}

export function resolveIdentityAssetState({ publishedVersion, draftVersion, subjectLogoUrl }: ResolveIdentityAssetStateArgs) {
  const officialAssets = collectUsedIdentityAssets(publishedVersion, "published");
  const draftAssets = collectUsedIdentityAssets(draftVersion, "draft");

  let officialLogo = officialAssets.find((asset) => asset.kind === "logo") ?? null;
  if (!officialLogo && subjectLogoUrl && isVisualAssetUrl(subjectLogoUrl)) {
    officialLogo = { kind: "logo", url: subjectLogoUrl, source: "subject" };
    officialAssets.unshift(officialLogo);
  }

  const draftLogoCandidate = draftAssets.find((asset) => asset.kind === "logo") ?? null;
  const draftLogo = draftLogoCandidate && draftLogoCandidate.url !== officialLogo?.url ? draftLogoCandidate : null;

  return { officialAssets, draftAssets, officialLogo, draftLogo };
}
