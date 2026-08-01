import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const { data: owned } = await admin.from("players").select("id,slug,display_name").eq("owner_user_id", user.id).maybeSingle();
    let player = owned;
    if (!player) {
      const { data: membership } = await admin.from("player_members").select("player_id,player:players(id,slug,display_name)").eq("user_id", user.id).eq("status", "active").limit(1).maybeSingle();
      player = membership?.player as unknown as typeof owned;
    }

    const [publicLinksResult, internalLinksResult, ownedStudiosResult, entitlementResult] = await Promise.all([
      player
        ? admin.from("player_studios").select("id,role,is_primary,is_visible,display_order,studio:studios(id,slug,name,logo_url,cover_url,publication_status,is_published,owner_id)").eq("player_id", player.id).eq("is_visible", true).order("display_order")
        : Promise.resolve({ data: [], error: null }),
      admin.from("studio_members").select("id,studio_id,role,status,studio:studios(id,slug,name,logo_url,cover_url,owner_id)").eq("profile_id", user.id).eq("status", "active"),
      admin.from("studios").select("id,slug,name,logo_url,cover_url,owner_id").eq("owner_id", user.id),
      admin.from("user_entitlements").select("tier,status,valid_from,valid_until,starts_at,expires_at").eq("user_id", user.id).eq("tier", "vip").eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    for (const result of [publicLinksResult, internalLinksResult, ownedStudiosResult, entitlementResult]) if (result.error) throw new Error(result.error.message);

    const entitlement = entitlementResult.data;
    const now = new Date().toISOString();
    const starts = entitlement?.valid_from || entitlement?.starts_at;
    const ends = entitlement?.valid_until || entitlement?.expires_at;
    const vipActive = Boolean(entitlement && (!starts || starts <= now) && (!ends || ends > now));

    // A studio's owner_id is the authoritative "can manage" signal (matches
    // requireStudioManager in lib/server/studio-permissions.ts) -- studio_members
    // is a separate, currently-empty staff roster and must not be the only check.
    const ownedStudioIds = new Set((ownedStudiosResult.data ?? []).map((studio) => studio.id));
    const internalByStudio = new Map((internalLinksResult.data ?? []).map((entry) => [entry.studio_id, entry]));
    const memberships = (publicLinksResult.data ?? []).map((entry) => {
      const studioId = (entry.studio as unknown as { id: string }).id;
      return {
        ...entry,
        internal_role: internalByStudio.get(studioId)?.role || null,
        can_manage: vipActive && (Boolean(internalByStudio.get(studioId)) || ownedStudioIds.has(studioId)),
      };
    });

    for (const internal of internalLinksResult.data ?? []) {
      if (!memberships.some((entry) => (entry.studio as unknown as { id: string }).id === internal.studio_id)) {
        memberships.push({
          id: internal.id,
          role: null,
          is_primary: false,
          is_visible: false,
          display_order: 999,
          studio: internal.studio,
          internal_role: internal.role,
          can_manage: vipActive,
        } as never);
      }
    }

    for (const owned of ownedStudiosResult.data ?? []) {
      if (!memberships.some((entry) => (entry.studio as unknown as { id: string }).id === owned.id)) {
        memberships.push({
          id: `owned-${owned.id}`,
          role: null,
          is_primary: false,
          is_visible: false,
          display_order: 999,
          studio: owned,
          internal_role: null,
          can_manage: vipActive,
        } as never);
      }
    }

    return NextResponse.json({ player, memberships, vipActive });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron cargar tus Estudios.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}
