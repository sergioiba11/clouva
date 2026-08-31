import type { Player } from "@/lib/players-data";

export type ClouvaSurfaceKey =
  | "HOME"
  | "PLAYER"
  | "MI_FLOW"
  | "CREATE"
  | "MI_SPOT"
  | "MARKET"
  | "MATRIX"
  | "STUDIOS";

export type ClouvaSurface = {
  key: ClouvaSurfaceKey;
  label: string;
  href: string;
  description: string;
};

export const CLOUVA_NAVIGATION: Record<ClouvaSurfaceKey, ClouvaSurface> = {
  HOME: {
    key: "HOME",
    label: "Inicio",
    href: "/",
    description: "Tu casa dentro de CLOUVA.",
  },
  PLAYER: {
    key: "PLAYER",
    label: "Player",
    href: "/perfil",
    description: "Tu identidad pública dentro de CLOUVA.",
  },
  MI_FLOW: {
    key: "MI_FLOW",
    label: "Mi Flow",
    href: "/mi-flow",
    description: "Billetera, ganancias, FLOWS, balances y objetivos.",
  },
  CREATE: {
    key: "CREATE",
    label: "Crear",
    href: "/crear",
    description: "Hub para crear media, identidad, avatar, ropa y 3D.",
  },
  MI_SPOT: {
    key: "MI_SPOT",
    label: "Mi Spot",
    href: "/mi-spot",
    description: "Los espacios, negocios y organizaciones que manejás.",
  },
  MARKET: {
    key: "MARKET",
    label: "Market",
    href: "/tienda",
    description: "Productos, servicios, merch físico y assets comerciables.",
  },
  MATRIX: {
    key: "MATRIX",
    label: "La Matrix",
    href: "/matrix",
    description: "Descubrimiento de Players, Studios y ecosistema CLOUVA.",
  },
  STUDIOS: {
    key: "STUDIOS",
    label: "Studios",
    href: "/studios",
    description: "Directorio público de Studios CLOUVA.",
  },
};

export const DESKTOP_PRIMARY_NAV_KEYS = ["HOME", "CREATE", "MARKET", "MATRIX"] as const satisfies readonly ClouvaSurfaceKey[];
export const MOBILE_PRIMARY_NAV_KEYS = ["HOME", "PLAYER", "CREATE", "MARKET", "MI_FLOW"] as const satisfies readonly ClouvaSurfaceKey[];

export type PlayerNavigationIdentity = Pick<Player, "slug" | "is_published" | "publication_status">;

export function getPlayerDestination(player: PlayerNavigationIdentity | null | undefined) {
  if (!player) return "/onboarding/identity";
  if (player.is_published && player.publication_status === "published" && player.slug) {
    return `/${encodeURIComponent(player.slug)}`;
  }
  return "/profile/edit";
}

export function getNavigationItems(keys: readonly ClouvaSurfaceKey[]) {
  return keys.map((key) => CLOUVA_NAVIGATION[key]);
}
