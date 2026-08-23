import type { SupabaseClient } from "@supabase/supabase-js";
import { requireStudioManager } from "@/lib/server/studio-permissions";

export async function requireManagedSpot(args: {
  admin: SupabaseClient;
  userId: string;
  studioId: string;
  spotId?: string | null;
}) {
  const permission = await requireStudioManager({
    admin: args.admin,
    userId: args.userId,
    studioId: args.studioId,
  });

  let query = args.admin
    .from("commerce_spots")
    .select("id,studio_id,slug,name,country_code,currency,timezone,fx_source,public_enabled,status,created_at,updated_at")
    .eq("studio_id", args.studioId);
  if (args.spotId) query = query.eq("id", args.spotId);
  else query = query.eq("status", "active").order("created_at").limit(1);

  const { data: spot, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!spot) {
    const missing = new Error("El Estudio todavía no tiene un Spot comercial activo.");
    (missing as Error & { status?: number }).status = 404;
    throw missing;
  }

  return { ...permission, spot };
}

export function apiErrorStatus(error: unknown, authFallback = 500) {
  return (error as Error & { status?: number })?.status ?? authFallback;
}

