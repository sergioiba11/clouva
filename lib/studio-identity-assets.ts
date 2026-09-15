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

function collectLayoutVisualUrls(value: unknown, path = "layout", output: VisualUrl[] = []): VisualUrl[] {
  if (typeof value === "string") {
    if (isVisualAssetUrl(value)) output.push({ url: value, kind: inferKindFromPath(path) });
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectLayoutVisualUrls(item, `${path}[${index}]`, output));
    return output;
  }
  if (!isRecord(value)) return output;
  Object.entries(value).forEach(([key, item]) => collectLayoutVisualUrls(item, `${path}.${key}`, output));
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
 * proves usage. Older identities that predate image_slots are supported by the
 * recursive layout walk. If a legacy version has no visual URLs in its layout,
 * its asset_references remain the fallback source of truth.
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
