const RESERVED_PUBLIC_ALIAS_VALUES = [
  "account",
  "admin",
  "api",
  "auth",
  "avatar-analyzer",
  "avatar-analyzer-v4",
  "biblioteca",
  "businesses",
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
  "gracias",
  "login",
  "logo",
  "lookbook",
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
  "privacidad",
  "producto",
  "profile",
  "q",
  "registro",
  "shop",
  "sobre-clouva",
  "spaces",
  "studio-dashboard",
  "studios",
  "terminos",
  "tienda",
  "truco",
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
