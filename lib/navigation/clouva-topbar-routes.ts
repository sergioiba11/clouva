import { isReservedPublicAlias } from "@/lib/navigation/reserved-public-aliases";

const PUBLIC_EXACT_PATHS = new Set([
  "/login",
  "/registro",
  "/auth",
  "/onboarding",
  "/gracias",
  "/privacidad",
  "/terminos",
  "/sobre-clouva",
  "/lookbook",
  "/tienda",
  "/catalogo",
  "/producto",
  "/q",
  "/mobile-preview",
  "/players",
  "/studios",
]);

const PUBLIC_PREFIXES = [
  "/auth/",
  "/onboarding/",
  "/perfil-publico/",
  "/u/",
  "/players/",
  "/studios/",
  "/spaces/",
  "/producto/",
  "/q/",
  "/tienda/",
  "/mobile-preview/",
] as const;

function normalizePathname(pathname: string) {
  const clean = pathname.trim().split("?")[0]?.split("#")[0] || "/";
  if (clean === "/") return clean;
  return clean.replace(/\/+$/, "") || "/";
}

/**
 * Internal preview tools own their own chrome. They still require an
 * authenticated Studio manager, but must not inherit the global CLOUVA bar,
 * floating assistant or Studio dashboard dock when rendered in an iframe.
 */
export function isImmersiveClouvaPreviewPath(pathname: string) {
  const normalized = normalizePathname(pathname);
  const segments = normalized.split("/").filter(Boolean);
  return segments.length === 3
    && segments[0] === "studio-dashboard"
    && segments[2] === "identity-preview";
}

/**
 * Public identity/storefront experiences own their visual chrome and must never
 * inherit the authenticated CLOUVA system bar. Internal surfaces are the
 * inverse: once the user is authenticated, the canonical top bar is mounted
 * globally by RootLayout instead of being copied into every page.
 */
export function isPublicClouvaExperiencePath(pathname: string) {
  const normalized = normalizePathname(pathname);
  if (normalized === "/") return false;
  if (PUBLIC_EXACT_PATHS.has(normalized)) return true;
  if (PUBLIC_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return true;

  // Every internal root surface is reserved from Player aliases by the same
  // canonical navigation contract. Therefore an unreserved first segment —
  // whether it is /artist or /brand/store — belongs to public chrome.
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length > 0 && !isReservedPublicAlias(segments[0])) return true;

  return false;
}

export function shouldShowClouvaSystemTopBar(pathname: string) {
  return !isImmersiveClouvaPreviewPath(pathname) && !isPublicClouvaExperiencePath(pathname);
}
