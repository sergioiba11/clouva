import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE_STUDIO_OS = new Set(["active", "grace", "legacy_active"]);

function studioOsActive(studio: { studio_os_status?: string | null; studio_os_expires_at?: string | null } | null | undefined) {
  if (!studio || !ACTIVE_STUDIO_OS.has(studio.studio_os_status || "")) return false;
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

    const [publicLinksResult, internalLinksResult, ownedStudiosResult, directMembershipsResult, spaceMembersResult, managementRequestsResult] = await Promise.all([
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
      owned
        ? admin
            .from("space_members")
            .select("id,space_id,player_id,role,status,created_at,updated_at")
            .eq("player_id", owned.id)
            .in("status", ["active", "invited"])
        : Promise.resolve({ data: [], error: null }),
      admin
        .from("space_management_requests")
        .select("id,space_id,requested_role,status,created_at,reviewed_at,decision_message")
        .eq("user_id", user.id)
        .in("status", ["pending", "approved", "rejected"])
        .order("created_at", { ascending: false }),
    ]);
    for (const result of [publicLinksResult, internalLinksResult, ownedStudiosResult, directMembershipsResult, spaceMembersResult, managementRequestsResult]) {
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
    type LegacyOutput = {
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

    const byStudio = new Map<string, LegacyOutput>();
    const addStudio = (entry: LegacyOutput) => {
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
      addStudio({ id: entry.id, role: entry.role, area_label: entry.area_label, internal_role: null, membership_status: "active", is_primary: entry.is_primary, can_manage: false, studio_os_active: studioOsActive(studio), studio });
    }
    for (const entry of directMembershipsResult.data ?? []) {
      const studio = entry.studio as unknown as StudioShape;
      addStudio({ id: entry.id, role: entry.public_role_label, area_label: entry.area_label, internal_role: null, membership_status: entry.status, is_primary: false, can_manage: false, studio_os_active: studioOsActive(studio), studio });
    }
    for (const entry of internalLinksResult.data ?? []) {
      const studio = entry.studio as unknown as StudioShape;
      const active = studioOsActive(studio);
      addStudio({ id: entry.id, role: null, area_label: null, internal_role: entry.role, membership_status: null, is_primary: false, can_manage: active, studio_os_active: active, studio });
    }
    for (const studio of (ownedStudiosResult.data ?? []) as StudioShape[]) {
      const active = studioOsActive(studio);
      addStudio({ id: `owned-${studio.id}`, role: "Fundador", area_label: "Dirección", internal_role: "owner", membership_status: null, is_primary: false, can_manage: active, studio_os_active: active, studio });
    }

    const memberBySpace = new Map<string, { id: string; role: string; status: string }>();
    for (const member of spaceMembersResult.data ?? []) {
      memberBySpace.set(String(member.space_id), { id: String(member.id), role: String(member.role), status: String(member.status) });
    }

    const requestBySpace = new Map<string, { id: string; requested_role: string; status: string; created_at: string; reviewed_at: string | null; decision_message: string | null }>();
    for (const managementRequest of managementRequestsResult.data ?? []) {
      const key = String(managementRequest.space_id);
      if (!requestBySpace.has(key)) {
        requestBySpace.set(key, {
          id: String(managementRequest.id),
          requested_role: String(managementRequest.requested_role),
          status: String(managementRequest.status),
          created_at: String(managementRequest.created_at),
          reviewed_at: managementRequest.reviewed_at ? String(managementRequest.reviewed_at) : null,
          decision_message: managementRequest.decision_message ? String(managementRequest.decision_message) : null,
        });
      }
    }

    const spaceIds = Array.from(new Set([...memberBySpace.keys(), ...requestBySpace.keys()]));
    const { data: spaces, error: spacesError } = spaceIds.length
      ? await admin
          .from("spaces")
          .select("id,slug,name,type,business_kind,category,subcategory,location_label,description,logo_url,cover_url,public_enabled,status,enabled_modules,owner_player_id,legacy_studio_id,legacy_commerce_spot_id")
          .in("id", spaceIds)
      : { data: [], error: null };
    if (spacesError) throw new Error(spacesError.message);

    const referencedStudioIds = Array.from(new Set((spaces ?? []).flatMap((space) => space.legacy_studio_id ? [String(space.legacy_studio_id)] : [])));
    const { data: referencedStudios, error: referencedStudiosError } = referencedStudioIds.length
      ? await admin.from("studios").select("id,slug,name,logo_url,cover_url,owner_id,studio_os_status,studio_os_expires_at").in("id", referencedStudioIds)
      : { data: [], error: null };
    if (referencedStudiosError) throw new Error(referencedStudiosError.message);
    const studioById = new Map((referencedStudios ?? []).map((studio) => [String(studio.id), studio as StudioShape]));

    const spaceOutputs = (spaces ?? []).map((space) => {
      const member = memberBySpace.get(String(space.id)) ?? null;
      const managementRequest = requestBySpace.get(String(space.id)) ?? null;
      const studio = space.legacy_studio_id ? studioById.get(String(space.legacy_studio_id)) ?? null : null;
      const legacy = studio ? byStudio.get(studio.id) ?? null : null;
      const relationRole = member?.role ?? null;
      const relationActive = member?.status === "active";
      const canManageByRelation = relationActive && ["owner", "admin", "manager"].includes(relationRole || "");
      const osActive = studio ? studioOsActive(studio) : true;

      return {
        id: member?.id || managementRequest?.id || `space-${space.id}`,
        entity_type: space.type,
        business_kind: space.business_kind,
        role: legacy?.role ?? null,
        area_label: legacy?.area_label ?? null,
        internal_role: relationRole || legacy?.internal_role || null,
        membership_status: member?.status || legacy?.membership_status || null,
        request_status: managementRequest?.status ?? null,
        requested_role: managementRequest?.requested_role ?? null,
        request_created_at: managementRequest?.created_at ?? null,
        is_primary: legacy?.is_primary ?? false,
        can_manage: canManageByRelation && osActive,
        studio_os_active: osActive,
        enabled_modules: Array.isArray(space.enabled_modules) ? space.enabled_modules : [],
        admin_href: space.legacy_studio_id
          ? `/studio-dashboard/${space.legacy_studio_id}`
          : space.legacy_commerce_spot_id
            ? `/mi-spot/${space.legacy_commerce_spot_id}`
            : null,
        team_href: `/businesses/${space.id}/team`,
        space,
        studio,
      };
    });

    return NextResponse.json({
      player: owned,
      spaces: spaceOutputs,
      memberships: [...byStudio.values()],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron cargar tus negocios y espacios.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}
