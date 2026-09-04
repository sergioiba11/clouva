import type { SupabaseClient } from "@supabase/supabase-js";
import { isSpotRole, spotRoleAllows, type SpotCapability, type SpotRole } from "@/lib/commerce/spot-permissions";
import { requireSpaceAdminPlan } from "@/lib/server/space-access";

const ROLE_PRIORITY: SpotRole[] = ["owner", "admin", "manager", "finance", "sales", "catalog", "inventory", "content", "support", "viewer"];

function statusError(message: string, status: number, code?: string) {
  const error = new Error(message) as Error & { status?: number; code?: string };
  error.status = status;
  if (code) error.code = code;
  return error;
}

export async function requireSpaceInventoryAccess(args: {
  admin: SupabaseClient;
  userId: string;
  spaceId: string;
  capability?: SpotCapability;
}) {
  const [{ data: space, error: spaceError }, { data: profile, error: profileError }] = await Promise.all([
    args.admin.from("spaces").select("id,slug,name,type,logo_url,accent_color,owner_player_id,legacy_studio_id,legacy_commerce_spot_id,status").eq("id", args.spaceId).maybeSingle(),
    args.admin.from("profiles").select("role").eq("id", args.userId).maybeSingle(),
  ]);
  if (spaceError) throw new Error(spaceError.message);
  if (profileError) throw new Error(profileError.message);
  if (!space) throw statusError("El Space no existe.", 404);

  const isGlobalAdmin = profile?.role === "admin";
  let role: SpotRole = isGlobalAdmin ? "admin" : "viewer";
  let playerId: string | null = null;

  if (!isGlobalAdmin) {
    const [{ data: owned, error: ownedError }, { data: memberships, error: memberError }] = await Promise.all([
      args.admin.from("players").select("id").eq("owner_user_id", args.userId),
      args.admin.from("player_members").select("player_id").eq("user_id", args.userId).eq("status", "active"),
    ]);
    if (ownedError) throw new Error(ownedError.message);
    if (memberError) throw new Error(memberError.message);

    const controlledPlayerIds = Array.from(new Set([
      ...(owned ?? []).map((row) => String(row.id)),
      ...(memberships ?? []).map((row) => String(row.player_id)),
    ]));
    if (!controlledPlayerIds.length) throw statusError("Tu cuenta no controla un Player activo.", 403);

    const { data: spaceMemberships, error: membershipError } = await args.admin
      .from("space_members")
      .select("player_id,role,status")
      .eq("space_id", args.spaceId)
      .eq("status", "active")
      .in("player_id", controlledPlayerIds);
    if (membershipError) throw new Error(membershipError.message);
    const valid = (spaceMemberships ?? []).filter((row) => isSpotRole(row.role));
    if (!valid.length) throw statusError("Tu Player no pertenece a este Space.", 403);

    valid.sort((a, b) => ROLE_PRIORITY.indexOf(a.role as SpotRole) - ROLE_PRIORITY.indexOf(b.role as SpotRole));
    role = valid[0].role as SpotRole;
    playerId = String(valid[0].player_id);
  }

  const capability = args.capability ?? "view";
  if (!isGlobalAdmin && !spotRoleAllows(role, capability)) {
    throw statusError(`Tu rol ${role} no permite esta operación.`, 403, "SPACE_ROLE_FORBIDDEN");
  }
  if (capability !== "view") await requireSpaceAdminPlan({ admin: args.admin, userId: args.userId });

  return { space, role, playerId, isGlobalAdmin };
}

export async function resolveSpaceForStudio(args: { admin: SupabaseClient; studioId: string }) {
  const { data, error } = await args.admin
    .from("spaces")
    .select("id,slug,name,type,logo_url,accent_color,legacy_studio_id,legacy_commerce_spot_id,status")
    .eq("legacy_studio_id", args.studioId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw statusError("Este Studio todavía no está proyectado como Space.", 404);
  return data;
}

export function inventoryStatus(quantity: number, minimum: number) {
  if (quantity <= 0) return "FALTA" as const;
  if (minimum > 0 && quantity <= minimum) return "BAJO" as const;
  return "OK" as const;
}
