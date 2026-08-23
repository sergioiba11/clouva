import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isSpotRole,
  spotRoleAllows,
  type SpotCapability,
  type SpotRole,
} from "@/lib/commerce/spot-permissions";
import { requireStudioManager } from "@/lib/server/studio-permissions";

const SPOT_SELECT = "id,studio_id,owner_type,owner_user_id,beneficiary_user_id,slug,name,country_code,currency,timezone,fx_source,public_enabled,status,business_type,business_categories,enabled_modules,brand_tone,description,logo_url,cover_url,accent_color,palette,ai_profile,settings,created_at,updated_at";

function statusError(message: string, status: number, code?: string) {
  const error = new Error(message) as Error & { status?: number; code?: string };
  error.status = status;
  if (code) error.code = code;
  return error;
}

export async function requireSpotAccess(args: {
  admin: SupabaseClient;
  userId: string;
  spotId: string;
  capability?: SpotCapability;
}) {
  const { data: spot, error } = await args.admin
    .from("commerce_spots")
    .select(SPOT_SELECT)
    .eq("id", args.spotId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!spot) throw statusError("El Spot no existe.", 404);

  const { data: rawRole, error: roleError } = await args.admin.rpc("commerce_spot_role_for_user", {
    p_spot_id: spot.id,
    p_user_id: args.userId,
  });
  if (roleError) throw new Error(roleError.message);
  if (!isSpotRole(rawRole)) throw statusError("No tenés acceso a este Spot.", 403);

  const role: SpotRole = rawRole;
  const capability = args.capability ?? "view";
  if (!spotRoleAllows(role, capability)) {
    throw statusError(`Tu rol ${role} no permite esta operación.`, 403, "SPOT_ROLE_FORBIDDEN");
  }

  let studio: { id: string; name: string; slug: string } | null = null;
  if (spot.owner_type === "studio" && spot.studio_id) {
    const { data: studioRow, error: studioError } = await args.admin
      .from("studios")
      .select("id,name,slug")
      .eq("id", spot.studio_id)
      .maybeSingle();
    if (studioError) throw new Error(studioError.message);
    studio = studioRow ?? null;
  }

  return { spot, role, studio };
}

export async function requireManagedSpot(args: {
  admin: SupabaseClient;
  userId: string;
  studioId: string;
  spotId?: string | null;
}) {
  // `/api/studios/[slug]/commerce/*` is the mature commerce surface. A direct
  // user-owned Spot reuses it through an explicit `spot:<uuid>` scope instead
  // of cloning scanner/POS/inventory implementations. Only broad operational
  // roles may enter this legacy all-tools surface; narrow roles are kept out
  // until an endpoint declares its own granular capability.
  if (args.studioId.startsWith("spot:")) {
    const directSpotId = args.studioId.slice("spot:".length).trim();
    if (!directSpotId) throw statusError("Spot inválido.", 400);
    const direct = await requireSpotAccess({
      admin: args.admin,
      userId: args.userId,
      spotId: directSpotId,
      capability: "operations",
    });
    if (args.spotId && args.spotId !== direct.spot.id) throw statusError("El Spot solicitado no coincide.", 404);
    return {
      studio: direct.studio ?? { id: direct.spot.id, name: direct.spot.name, slug: direct.spot.slug },
      role: direct.role,
      studioOsActive: true as const,
      spot: direct.spot,
    };
  }

  const permission = await requireStudioManager({
    admin: args.admin,
    userId: args.userId,
    studioId: args.studioId,
  });

  let query = args.admin
    .from("commerce_spots")
    .select(SPOT_SELECT)
    .eq("studio_id", args.studioId);
  if (args.spotId) query = query.eq("id", args.spotId);
  else query = query.eq("status", "active").order("created_at").limit(1);

  const { data: spot, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!spot) throw statusError("El Estudio todavía no tiene un Spot comercial activo.", 404);

  return { ...permission, spot };
}

export function apiErrorStatus(error: unknown, authFallback = 500) {
  return (error as Error & { status?: number })?.status ?? authFallback;
}
