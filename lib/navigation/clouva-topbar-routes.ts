import { isReservedPublicAlias } from "@/lib/navigation/reserved-public-aliases";

const PUBLIC_EXACT_PATHS = new Set([
  "/login",
  "/registro",
  "/gracias",
  "/privacidad",
  "/terminos",
  "/sobre-clouva",
  "/lookbook",
  "/tienda",
  "/catalogo",
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

  // The canonical Player profile lives at /[publicAlias]. Static system routes
  // are already protected by RESERVED_PUBLIC_ALIASES, so an unknown single
  // segment is a public Player identity and must keep its own header.
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 1 && !isReservedPublicAlias(segments[0])) return true;

  return false;
}

export function shouldShowClouvaSystemTopBar(pathname: string) {
  return !isPublicClouvaExperiencePath(pathname);
}
