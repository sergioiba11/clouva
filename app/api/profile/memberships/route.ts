import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE_STUDIO_OS = new Set(["active", "grace", "legacy_active"]);

function studioOsActive(studio: { studio_os_status?: string | null; studio_os_expires_at?: string | null }) {
  if (!ACTIVE_STUDIO_OS.has(studio.studio_os_status || "")) return false;
  return !studio.studio_os_expires_at || new Date(studio.studio_os_expires_at) > new Date();
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();
    const { data: owned, error: playerError } = await admin
      .from("players")
      .select("id,slug,display_name")
      .eq("owner_user_id", user.id)
      .maybeSingle();
    if (playerError) throw new Error(playerError.message);

    const [publicLinksResult, internalLinksResult, ownedStudiosResult, directMembershipsResult] = await Promise.all([
      owned
        ? admin
            .from("player_studios")
            .select("id,role,area_label,is_primary,is_visible,display_order,studio:studios(id,slug,name,logo_url,cover_url,publication_status,is_published,owner_id,studio_os_status,studio_os_expires_at)")
            .eq("player_id", owned.id)
            .eq("status", "active")
            .order("display_order")
        : Promise.resolve({ data: [], error: null }),
      admin
        .from("studio_members")
        .select("id,studio_id,role,status,studio:studios(id,slug,name,logo_url,cover_url,owner_id,studio_os_status,studio_os_expires_at)")
        .eq("profile_id", user.id)
        .eq("status", "active"),
      admin
        .from("studios")
        .select("id,slug,name,logo_url,cover_url,owner_id,studio_os_status,studio_os_expires_at")
        .eq("owner_id", user.id),
      admin
        .from("studio_memberships")
        .select("id,studio_id,public_role_label,area_label,status,studio:studios(id,slug,name,logo_url,cover_url,owner_id,studio_os_status,studio_os_expires_at)")
        .eq("user_id", user.id)
        .in("status", ["active", "pending"]),
    ]);
    for (const result of [publicLinksResult, internalLinksResult, ownedStudiosResult, directMembershipsResult]) {
      if (result.error) throw new Error(result.error.message);
    }

    type StudioShape = {
      id: string;
      slug: string;
      name: string;
      logo_url: string | null;
      cover_url: string | null;
      owner_id: string;
      studio_os_status: string;
      studio_os_expires_at: string | null;
    };
    type Output = {
      id: string;
      role: string | null;
      area_label: string | null;
      internal_role: string | null;
      membership_status: string | null;
      is_primary: boolean;
      can_manage: boolean;
      studio_os_active: boolean;
      studio: StudioShape;
    };

    const byStudio = new Map<string, Output>();
    const add = (entry: Output) => {
      const existing = byStudio.get(entry.studio.id);
      byStudio.set(entry.studio.id, existing ? {
        ...existing,
        ...entry,
        role: entry.role || existing.role,
        area_label: entry.area_label || existing.area_label,
        internal_role: entry.internal_role || existing.internal_role,
        membership_status: entry.membership_status || existing.membership_status,
        is_primary: entry.is_primary || existing.is_primary,
        can_manage: entry.can_manage || existing.can_manage,
      } : entry);
    };

    for (const entry of publicLinksResult.data ?? []) {
      const studio = entry.studio as unknown as StudioShape;
      add({
        id: entry.id,
        role: entry.role,
        area_label: entry.area_label,
        internal_role: null,
        membership_status: "active",
        is_primary: entry.is_primary,
        can_manage: false,
        studio_os_active: studioOsActive(studio),
        studio,
      });
    }

    for (const entry of directMembershipsResult.data ?? []) {
      const studio = entry.studio as unknown as StudioShape;
      add({
        id: entry.id,
        role: entry.public_role_label,
        area_label: entry.area_label,
        internal_role: null,
        membership_status: entry.status,
        is_primary: false,
        can_manage: false,
        studio_os_active: studioOsActive(studio),
        studio,
      });
    }

    for (const entry of internalLinksResult.data ?? []) {
      const studio = entry.studio as unknown as StudioShape;
      const active = studioOsActive(studio);
      add({
        id: entry.id,
        role: null,
        area_label: null,
        internal_role: entry.role,
        membership_status: null,
        is_primary: false,
        can_manage: active,
        studio_os_active: active,
        studio,
      });
    }

    for (const studio of (ownedStudiosResult.data ?? []) as StudioShape[]) {
      const active = studioOsActive(studio);
      add({
        id: `owned-${studio.id}`,
        role: "Fundador",
        area_label: "Dirección",
        internal_role: "owner",
        membership_status: null,
        is_primary: false,
        can_manage: active,
        studio_os_active: active,
        studio,
      });
    }

    return NextResponse.json({ player: owned, memberships: [...byStudio.values()] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron cargar tus Estudios.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}
