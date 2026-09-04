import type { SupabaseClient, User } from "@supabase/supabase-js";

export type VehicleAccess = {
  vehicle: Record<string, unknown> & { id: string; player_id: string };
  player: { id: string; owner_user_id: string };
  canManage: boolean;
};

const MANAGER_ROLES = new Set(["owner", "manager", "editor"]);

export async function requireOwnedPlayer(admin: SupabaseClient, user: User) {
  const { data: player, error } = await admin
    .from("players")
    .select("id,slug,display_name,owner_user_id")
    .eq("owner_user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!player) throw new Error("Tu cuenta todavía no tiene un Player activo.");
  return player as { id: string; slug: string; display_name: string | null; owner_user_id: string };
}

export async function requireVehicleAccess(
  admin: SupabaseClient,
  user: User,
  vehicleId: string,
  requireManage = false,
): Promise<VehicleAccess> {
  const { data: vehicle, error: vehicleError } = await admin
    .from("vehicles")
    .select("*")
    .eq("id", vehicleId)
    .maybeSingle();
  if (vehicleError) throw new Error(vehicleError.message);
  if (!vehicle) throw new Error("Vehículo no encontrado.");

  const { data: player, error: playerError } = await admin
    .from("players")
    .select("id,owner_user_id")
    .eq("id", vehicle.player_id)
    .maybeSingle();
  if (playerError) throw new Error(playerError.message);
  if (!player) throw new Error("El Player del vehículo no existe.");

  let canView = player.owner_user_id === user.id;
  let canManage = canView;
  if (!canView || requireManage) {
    const { data: membership, error: membershipError } = await admin
      .from("player_members")
      .select("role,status")
      .eq("player_id", player.id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (membershipError) throw new Error(membershipError.message);
    if (membership) {
      canView = true;
      canManage = MANAGER_ROLES.has(String(membership.role));
    }
  }

  if (!canView || (requireManage && !canManage)) throw new Error("No autorizado para este vehículo.");
  return { vehicle, player, canManage } as VehicleAccess;
}

export function asText(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function asNullableText(value: unknown, max = 500) {
  const text = asText(value, max);
  return text || null;
}

export function asNonNegativeInt(value: unknown, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

export function asNonNegativeMoney(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed * 100) / 100);
}
