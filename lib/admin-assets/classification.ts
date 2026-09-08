export type AdminAssetSource = "gcs" | "supabase" | "github";

export type AdminAsset = {
  source: AdminAssetSource;
  bucket: string;
  name: string;
  path: string;
  folder: string;
  url: string | null;
  size: number;
  contentType: string | null;
  updatedAt: string | null;
};

export type AdminAssetKind = "image" | "video" | "audio" | "3d" | "document" | "other";
export type AdminAssetCategory =
  | "brand"
  | "icons"
  | "ui"
  | "backgrounds"
  | "players"
  | "clothing"
  | "products"
  | "3d"
  | "unreal"
  | "audio"
  | "video"
  | "documents"
  | "uploads"
  | "uncategorized";

export type NormalizedAdminAsset = AdminAsset & {
  key: string;
  extension: string;
  kind: AdminAssetKind;
  category: AdminAssetCategory;
  categoryLabel: string;
  subcategory: string | null;
  familyKey: string | null;
  familyLabel: string | null;
  familyVariant: string | null;
  searchText: string;
};

export const ASSET_CATEGORIES: Array<{ id: AdminAssetCategory; label: string }> = [
  { id: "brand", label: "Marca / Logos" },
  { id: "icons", label: "Iconos" },
  { id: "ui", label: "UI" },
  { id: "backgrounds", label: "Fondos" },
  { id: "players", label: "Players / Avatares" },
  { id: "clothing", label: "Ropa" },
  { id: "products", label: "Productos" },
  { id: "3d", label: "3D" },
  { id: "unreal", label: "Unreal" },
  { id: "audio", label: "Audio" },
  { id: "video", label: "Video" },
  { id: "documents", label: "Documentos" },
  { id: "uploads", label: "Uploads" },
  { id: "uncategorized", label: "Sin clasificar" },
];

const CATEGORY_LABELS = Object.fromEntries(ASSET_CATEGORIES.map((entry) => [entry.id, entry.label])) as Record<AdminAssetCategory, string>;

const IMAGE_EXTENSIONS = new Set(["PNG", "JPG", "JPEG", "WEBP", "GIF", "SVG", "ICO", "ICNS"]);
const VIDEO_EXTENSIONS = new Set(["MP4", "WEBM", "MOV"]);
const AUDIO_EXTENSIONS = new Set(["MP3", "WAV", "OGG", "M4A"]);
const MODEL_EXTENSIONS = new Set(["GLB", "GLTF", "FBX", "OBJ"]);
const DOCUMENT_EXTENSIONS = new Set(["PDF", "TXT", "JSON", "CSV", "MD", "XML", "CSS", "WEBMANIFEST"]);

function clean(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function tokens(value: string) {
  return clean(value).split(/[^a-z0-9]+/g).filter(Boolean);
}

function hasAny(haystack: string, values: string[]) {
  return values.some((value) => haystack.includes(value));
}

function pathSegments(asset: AdminAsset) {
  return clean(`${asset.folder}/${asset.path}`).split("/").filter(Boolean);
}

function hasSegment(asset: AdminAsset, values: string[]) {
  const segments = pathSegments(asset);
  return values.some((value) => segments.includes(value));
}

function semanticText(asset: AdminAsset) {
  return clean(`${asset.bucket} ${asset.folder} ${asset.path} ${asset.name}`);
}

export function adminAssetKey(asset: AdminAsset) {
  return `${asset.source}:${asset.bucket}:${asset.path}`;
}

export function adminAssetExtension(asset: Pick<AdminAsset, "name">) {
  const extension = asset.name.split(".").pop()?.trim().toUpperCase() ?? "";
  if (!extension || extension === asset.name.toUpperCase()) return "SIN EXT";
  return extension;
}

export function deriveAssetKind(asset: AdminAsset): AdminAssetKind {
  const mime = clean(asset.contentType ?? "");
  const extension = adminAssetExtension(asset);
  if (mime.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) return "image";
  if (mime.startsWith("video/") || VIDEO_EXTENSIONS.has(extension)) return "video";
  if (mime.startsWith("audio/") || AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (mime.includes("gltf") || MODEL_EXTENSIONS.has(extension)) return "3d";
  if (mime.includes("pdf") || mime.startsWith("text/") || DOCUMENT_EXTENSIONS.has(extension)) return "document";
  return "other";
}

export function categoryLabel(category: AdminAssetCategory) {
  return CATEGORY_LABELS[category];
}

export function deriveAssetCategory(asset: AdminAsset): AdminAssetCategory {
  const text = semanticText(asset);
  const extension = adminAssetExtension(asset);
  const kind = deriveAssetKind(asset);

  if (hasSegment(asset, ["brand", "logos", "logo"]) || /(^|[\/_-])logo([\/_\-.]|$)/.test(clean(asset.path))) return "brand";
  if (hasSegment(asset, ["icons", "icon"]) || /(^|[\/_-])(favicon|app-icon|icon)([\/_\-.]|$)/.test(clean(asset.path))) return "icons";
  if (hasSegment(asset, ["ui", "interface", "interfaces"])) return "ui";
  if (hasSegment(asset, ["backgrounds", "background", "fondos", "wallpapers", "wallpaper"]) || hasAny(text, ["background", "wallpaper", "fondo-"])) return "backgrounds";
  if (hasSegment(asset, ["products", "product", "productos"]) || hasAny(text, ["product-preview", "product-image"])) return "products";
  if (hasSegment(asset, ["players", "player", "avatars", "avatar"]) || hasAny(text, [" avatar", "avatar-", "body", "player-"])) return "players";
  if (hasSegment(asset, ["garments", "garment", "clothing", "clothes", "ropa"]) || hasAny(text, ["garment", "clothing", "hoodie", "buzo", "remera", "campera", "pantalon", "pants", "shirt", "sweater", "jacket"])) return "clothing";
  if (hasSegment(asset, ["unreal", "ue", "ue5"]) || /(^|[^a-z])unreal([^a-z]|$)/.test(text)) return "unreal";
  if (hasSegment(asset, ["3d", "models", "model"]) || MODEL_EXTENSIONS.has(extension) || kind === "3d") return "3d";
  if (hasSegment(asset, ["audio", "music", "sounds", "sound"]) || kind === "audio") return "audio";
  if (hasSegment(asset, ["video", "videos"]) || kind === "video") return "video";
  if (hasSegment(asset, ["documents", "document", "docs"]) || kind === "document") return "documents";
  if (hasSegment(asset, ["uploads", "upload"])) return "uploads";
  return "uncategorized";
}

export function deriveAssetSubcategory(asset: AdminAsset, category = deriveAssetCategory(asset)) {
  const text = semanticText(asset);
  const segments = pathSegments(asset);

  if (category === "brand") {
    if (segments.includes("light") || hasAny(text, ["white", "light-on-black", "logo-light"])) return "Light";
    if (segments.includes("black") || hasAny(text, ["black", "dark-on-white", "logo-black"])) return "Black";
    if (hasAny(text, ["favicon", "app-icon", "icon"])) return "App / Favicon";
    return "Logo";
  }
  if (category === "players") return hasAny(text, ["rig", "skeleton", "avatar"]) ? "Avatar / Rig" : "Player";
  if (category === "clothing") {
    if (hasAny(text, ["hoodie", "buzo", "sweater"])) return "Buzo / Hoodie";
    if (hasAny(text, ["remera", "shirt"])) return "Remera";
    if (hasAny(text, ["pants", "pantalon"])) return "Pantalón";
    return "Prenda";
  }
  if (category === "unreal") return "Unreal Engine";
  if (category === "3d") return adminAssetExtension(asset);
  return null;
}

function titleFromFamilyBase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

export function deriveAssetFamily(asset: AdminAsset) {
  const extension = adminAssetExtension(asset);
  const lowerName = clean(asset.name);
  const stem = lowerName.replace(/\.[^.]+$/, "");
  const structured = clean(asset.path).match(/(?:^|\/)brand\/clouva-logo\/(black|light|adaptive|shared)\/([^/]+)\/(.+)$/);

  if (structured) {
    const variant = structured[1];
    const nestedName = structured[3].split("/").at(-1) ?? stem;
    const nestedStem = nestedName.replace(/\.[^.]+$/, "");
    const stripped = nestedStem.replace(/(?:[-_](?:64|128|256|512|1024|2048)(?:x(?:64|128|256|512|1024|2048))?|[-_](?:64|128|256|512|1024|2048)x(?:64|128|256|512|1024|2048)|@(?:2x|3x))$/i, "");
    if (stripped !== nestedStem) {
      const suffix = nestedStem.slice(stripped.length).replace(/^[-_]/, "").toUpperCase();
      return {
        key: `structured:${variant}:${structured[2]}:${stripped}`,
        label: titleFromFamilyBase(stripped),
        variant: suffix || extension,
      };
    }
  }

  const match = stem.match(/^(.*?)(?:[-_](64|128|256|512|1024|2048)(?:x\2)?|[-_]((?:64|128|256|512|1024|2048)x(?:64|128|256|512|1024|2048))|@(2x|3x))$/i);
  if (!match) return { key: null, label: null, variant: null };

  const base = (match[1] ?? "").replace(/[-_]+$/, "");
  if (base.length < 3) return { key: null, label: null, variant: null };
  const variant = (match[2] || match[3] || match[4] || extension).toUpperCase();
  const parent = clean(asset.folder || asset.path.split("/").slice(0, -1).join("/"));
  return {
    key: `${asset.source}:${asset.bucket}:${parent}:${base}`,
    label: titleFromFamilyBase(base),
    variant,
  };
}

export function normalizeAdminAsset(asset: AdminAsset): NormalizedAdminAsset {
  const extension = adminAssetExtension(asset);
  const kind = deriveAssetKind(asset);
  const category = deriveAssetCategory(asset);
  const subcategory = deriveAssetSubcategory(asset, category);
  const family = deriveAssetFamily(asset);
  const label = categoryLabel(category);
  const searchText = clean([
    asset.name,
    asset.path,
    asset.folder,
    asset.bucket,
    asset.source,
    extension,
    kind,
    label,
    subcategory ?? "",
    family.label ?? "",
  ].join(" "));

  return {
    ...asset,
    key: adminAssetKey(asset),
    extension,
    kind,
    category,
    categoryLabel: label,
    subcategory,
    familyKey: family.key,
    familyLabel: family.label,
    familyVariant: family.variant,
    searchText,
  };
}

export function normalizeAdminAssets(assets: AdminAsset[]) {
  return assets.map(normalizeAdminAsset);
}

export function isTechnicalIdentifier(value: string) {
  const normalized = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    || /^[0-9a-f]{24,}$/i.test(normalized);
}

export function compactPath(path: string, max = 54) {
  if (path.length <= max) return path;
  const parts = path.split("/");
  if (parts.length <= 2) return `…${path.slice(-(max - 1))}`;
  const first = isTechnicalIdentifier(parts[0]) ? "…" : parts[0];
  const tail = parts.slice(-2).join("/");
  return `${first}/…/${tail}`.slice(-max);
}
