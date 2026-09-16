export const MATRIX_STUDIOS_BASE_PATH = "/lamatrix/estudios";

export function studioPublicHref(aliasOrSlug: string) {
  const clean = aliasOrSlug.trim().replace(/^\/+|\/+$/g, "");
  return `${MATRIX_STUDIOS_BASE_PATH}/${encodeURIComponent(clean)}`;
}
