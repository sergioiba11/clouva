export type Role = "admin" | "empleado" | "cliente" | "vip";

export const roleHome: Record<Role, string> = {
  admin: "/admin",
  empleado: "/empleado",
  cliente: "/mi-flow",
  vip: "/mi-flow",
};

export function normalizeRole(value: string | null | undefined): Role {
  if (value === "admin") return "admin";
  if (value === "employee" || value === "empleado") return "empleado";
  if (value === "customer" || value === "cliente") return "cliente";
  if (value === "vip") return "vip";
  return "cliente";
}

export function canAccessAdmin(role: Role) {
  return role === "admin";
}

export function canAccessEmployee(role: Role) {
  return role === "admin" || role === "empleado";
}

export function canAccessCustomer(role: Role) {
  return role === "admin" || role === "empleado" || role === "cliente" || role === "vip";
}
