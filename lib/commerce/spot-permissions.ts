export const SPOT_ROLES = [
  "owner",
  "admin",
  "manager",
  "catalog",
  "inventory",
  "sales",
  "finance",
  "content",
  "support",
  "viewer",
] as const;

export type SpotRole = (typeof SPOT_ROLES)[number];

export const SPOT_CAPABILITIES = [
  "view",
  "operations",
  "catalog",
  "inventory",
  "sales",
  "finance",
  "content",
  "support",
  "settings",
  "team",
  "transfer_owner",
] as const;

export type SpotCapability = (typeof SPOT_CAPABILITIES)[number];

const ROLE_CAPABILITIES: Record<SpotRole, ReadonlySet<SpotCapability>> = {
  owner: new Set(SPOT_CAPABILITIES),
  admin: new Set(SPOT_CAPABILITIES.filter((capability) => capability !== "transfer_owner")),
  manager: new Set(["view", "operations", "catalog", "inventory", "sales", "finance", "content", "support", "settings"]),
  catalog: new Set(["view", "catalog", "content"]),
  inventory: new Set(["view", "inventory"]),
  sales: new Set(["view", "sales", "support"]),
  finance: new Set(["view", "finance"]),
  content: new Set(["view", "content"]),
  support: new Set(["view", "support"]),
  viewer: new Set(["view"]),
};

export function isSpotRole(value: unknown): value is SpotRole {
  return typeof value === "string" && (SPOT_ROLES as readonly string[]).includes(value);
}

export function spotRoleAllows(role: SpotRole, capability: SpotCapability) {
  return ROLE_CAPABILITIES[role].has(capability);
}

export function spotRoleCapabilities(role: SpotRole) {
  return SPOT_CAPABILITIES.filter((capability) => ROLE_CAPABILITIES[role].has(capability));
}

export const SPOT_ROLE_LABELS: Record<SpotRole, string> = {
  owner: "Propietario",
  admin: "Administrador",
  manager: "Manager",
  catalog: "Catálogo",
  inventory: "Inventario",
  sales: "Ventas",
  finance: "Finanzas",
  content: "Contenido",
  support: "Soporte",
  viewer: "Solo lectura",
};
