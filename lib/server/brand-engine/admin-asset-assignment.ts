export type AdminIdentityAssetSource = "gcs" | "supabase" | "github";

export const BRAND_IDENTITY_ROLES = [
  "primary",
  "symbol",
  "horizontal",
  "vertical",
  "square",
  "transparent",
  "white",
  "black",
  "favicon",
  "master-svg",
  "symbol-svg",
  "horizontal-svg",
  "vertical-svg",
  "white-svg",
  "black-svg",
  "monochrome-svg",
  "print-pdf",
  "brand-config",
] as const;

export type BrandIdentityRole = (typeof BRAND_IDENTITY_ROLES)[number];

export const BRAND_IDENTITY_ROLE_COLUMNS: Record<BrandIdentityRole, string> = {
  primary: "primary_logo_url",
  symbol: "symbol_logo_url",
  horizontal: "horizontal_logo_url",
  vertical: "vertical_logo_url",
  square: "square_logo_url",
  transparent: "transparent_logo_url",
  white: "white_logo_url",
  black: "black_logo_url",
  favicon: "favicon_url",
  "master-svg": "master_svg_url",
  "symbol-svg": "symbol_svg_url",
  "horizontal-svg": "horizontal_svg_url",
  "vertical-svg": "vertical_svg_url",
  "white-svg": "white_svg_url",
  "black-svg": "black_svg_url",
  "monochrome-svg": "monochrome_svg_url",
  "print-pdf": "print_pdf_url",
  "brand-config": "brand_config_url",
};

export function isBrandIdentityRole(value: unknown): value is BrandIdentityRole {
  return typeof value === "string" && (BRAND_IDENTITY_ROLES as readonly string[]).includes(value);
}

export function safeAdminAssetPath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (!segments.length || segments.some((segment) => segment === "." || segment === "..")) return null;
  return segments.join("/");
}

export function extensionForAdminAsset(path: string) {
  const clean = path.split(/[?#]/, 1)[0];
  const file = clean.split("/").at(-1) ?? "";
  const dot = file.lastIndexOf(".");
  return dot >= 0 ? file.slice(dot + 1).toLowerCase() : "";
}

export function roleAcceptsPath(role: BrandIdentityRole, path: string) {
  const extension = extensionForAdminAsset(path);
  if (role.endsWith("-svg")) return extension === "svg";
  if (role === "print-pdf") return extension === "pdf";
  if (role === "brand-config") return extension === "json";
  if (role === "favicon") return ["png", "ico", "svg", "webp"].includes(extension);
  return ["png", "jpg", "jpeg", "webp", "svg"].includes(extension);
}

export function gcsAdminAssetUrl(bucket: string, path: string) {
  if (!/^[a-zA-Z0-9._-]+$/.test(bucket)) throw new Error("Bucket de Google Cloud inválido.");
  const safePath = safeAdminAssetPath(path);
  if (!safePath) throw new Error("Ruta de asset inválida.");
  return `https://storage.googleapis.com/${bucket}/${safePath.split("/").map(encodeURIComponent).join("/")}`;
}

export function adminAssetSourceNote(source: AdminIdentityAssetSource, bucket: string, path: string) {
  return `admin-assets:${source}:${bucket}:${path}`;
}
