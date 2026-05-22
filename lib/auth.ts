export type Role = "admin" | "employee" | "customer";

export const roleHome: Record<Role, string> = {
  admin: "/admin",
  employee: "/empleado",
  customer: "/cuenta",
};

export function normalizeRole(value: string | null | undefined): Role {
  if (value === "admin") return "admin";
  if (value === "employee") return "employee";
  return "customer";
}

export function canAccessAdmin(role: Role) {
  return role === "admin";
}

export function canAccessEmployee(role: Role) {
  return role === "admin" || role === "employee";
}

export function canAccessCustomer(role: Role) {
  return role === "admin" || role === "employee" || role === "customer";
}
