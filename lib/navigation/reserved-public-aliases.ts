const RESERVED_PUBLIC_ALIAS_VALUES = [
  "account",
  "admin",
  "api",
  "auth",
  "avatar-analyzer",
  "avatar-analyzer-v4",
  "biblioteca",
  "carrito",
  "catalogo",
  "checkout",
  "clouva-ai",
  "clouva-lab",
  "crear",
  "creator-studio",
  "cuenta",
  "debug-auth",
  "empleado",
  "login",
  "logo",
  "matrix",
  "market",
  "mi-flow",
  "mi-qr",
  "mi-spot",
  "mobile-preview",
  "onboarding",
  "pedido",
  "perfil",
  "perfil-publico",
  "players",
  "producto",
  "profile",
  "registro",
  "shop",
  "studio-dashboard",
  "studios",
  "tienda",
  "u",
  "vip",
] as const;

export const RESERVED_PUBLIC_ALIASES = new Set<string>(RESERVED_PUBLIC_ALIAS_VALUES);

export function normalizePublicAlias(value: string) {
  return value.trim().toLowerCase().replace(/^@/, "");
}

export function isReservedPublicAlias(value: string) {
  return RESERVED_PUBLIC_ALIASES.has(normalizePublicAlias(value));
}
