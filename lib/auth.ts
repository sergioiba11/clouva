export type Role = "owner" | "admin" | "customer";
const envRole = (process.env.NEXT_PUBLIC_DEMO_ROLE as Role) || "customer";
export const mockCurrentUser = { id: "u_1", role: envRole, name: "CLOUVA USER" };
export function canAccessAdmin(role: Role) { return role === "owner" || role === "admin"; }
export function canAccessFlow(role: Role) { return role === "owner" || role === "admin"; }
