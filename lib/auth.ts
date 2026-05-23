export type Role = "admin" | "empleado" | "cliente" | "vip";

const ADMIN_ALIASES = new Set(["admin", "super_admin", "owner"]);

function roleFromObject(value: Record<string, unknown>): unknown {
  if ("role" in value) return value.role;
  if ("value" in value) return value.value;
  if ("name" in value) return value.name;
  return value;
}

export function extractRoleValue(rawRole: unknown): string | null {
  if (rawRole == null) return null;
  if (typeof rawRole === "string") return rawRole;
  if (typeof rawRole === "object") {
    const candidate = roleFromObject(rawRole as Record<string, unknown>);
    if (typeof candidate === "string") return candidate;
  }
  return String(rawRole);
}

export const roleHome: Record<Role, string> = {
  admin: "/admin",
  empleado: "/empleado",
  cliente: "/mi-flow",
  vip: "/mi-flow",
};

export function normalizeRole(value: unknown): Role {
  const extracted = extractRoleValue(value);
  if (!extracted) return "cliente";

  const normalized = extracted.trim().toLowerCase();
  if (ADMIN_ALIASES.has(normalized)) return "admin";
  if (normalized === "employee" || normalized === "empleado") return "empleado";
  if (normalized === "customer" || normalized === "cliente") return "cliente";
  if (normalized === "vip") return "vip";
  return "cliente";
}

export function getRedirectByRole(role: string | null | undefined) {
  const normalizedRole = normalizeRole(role);
  return roleHome[normalizedRole];
}

export function canAccessAdmin(role: Role) {
  return normalizeRole(role) === "admin";
}

export function canAccessEmployee(role: Role) {
  return role === "admin" || role === "empleado";
}

export function canAccessCustomer(role: Role) {
  return role === "admin" || role === "empleado" || role === "cliente" || role === "vip";
}
