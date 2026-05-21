export type Role = "owner" | "admin" | "customer";
export const mockCurrentUser = { id: "u_1", role: "owner" as Role, name: "CLOUVA OWNER" };
export function canAccessAdmin(role: Role) { return role === "owner" || role === "admin"; }
export function canAccessFlow(role: Role) { return role === "owner"; }
