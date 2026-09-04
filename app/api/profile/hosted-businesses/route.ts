import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOST_MANAGER_ROLES = ["owner", "admin", "manager"];

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireUser(request);
    const admin = createAdminSupabase();

    const [{ data: ownedPlayers, error: ownedError }, { data: playerMemberships, error: memberError }] = await Promise.all([
      admin.from("players").select("id").eq("owner_user_id", user.id),
      admin.from("player_members").select("player_id").eq("user_id", user.id).eq("status", "active"),
    ]);
    if (ownedError) throw new Error(ownedError.message);
    if (memberError) throw new Error(memberError.message);

    const controlledPlayerIds = Array.from(new Set([
      ...(ownedPlayers ?? []).map((row) => String(row.id)),
      ...(playerMemberships ?? []).map((row) => String(row.player_id)),
    ]));
    if (!controlledPlayerIds.length) return NextResponse.json({ spaces: [] });

    const { data: hostMemberships, error: hostMembershipError } = await admin
      .from("space_members")
      .select("space_id,player_id,role,status")
      .eq("status", "active")
      .in("role", HOST_MANAGER_ROLES)
      .in("player_id", controlledPlayerIds);
    if (hostMembershipError) throw new Error(hostMembershipError.message);

    const hostSpaceIds = Array.from(new Set((hostMemberships ?? []).map((row) => String(row.space_id))));
    if (!hostSpaceIds.length) return NextResponse.json({ spaces: [] });

    const [hostedAtResult, containsResult] = await Promise.all([
      admin
        .from("space_relationships")
        .select("id,source_space_id,target_space_id,relationship_type,status")
        .eq("relationship_type", "hosted_at")
        .eq("status", "active")
        .in("target_space_id", hostSpaceIds),
      admin
        .from("space_relationships")
        .select("id,source_space_id,target_space_id,relationship_type,status")
        .eq("relationship_type", "contains")
        .eq("status", "active")
        .in("source_space_id", hostSpaceIds),
    ]);
    if (hostedAtResult.error) throw new Error(hostedAtResult.error.message);
    if (containsResult.error) throw new Error(containsResult.error.message);

    const relations = [
      ...(hostedAtResult.data ?? []).map((row) => ({ ...row, childSpaceId: String(row.source_space_id), hostSpaceId: String(row.target_space_id) })),
      ...(containsResult.data ?? []).map((row) => ({ ...row, childSpaceId: String(row.target_space_id), hostSpaceId: String(row.source_space_id) })),
    ];
    const childIds = Array.from(new Set(relations.map((row) => row.childSpaceId)));
    if (!childIds.length) return NextResponse.json({ spaces: [] });

    const { data: children, error: childrenError } = await admin
      .from("spaces")
      .select("id,slug,name,type,business_kind,category,subcategory,location_label,description,logo_url,cover_url,public_enabled,status,enabled_modules,owner_player_id,legacy_studio_id,legacy_commerce_spot_id")
      .in("id", childIds)
      .eq("status", "active");
    if (childrenError) throw new Error(childrenError.message);

    const relationByChild = new Map(relations.map((row) => [row.childSpaceId, row]));
    const spaces = (children ?? [])
      .filter((space) => space.type === "business" || space.business_kind === "digital_business" || space.business_kind === "physical_business")
      .map((space) => {
        const relation = relationByChild.get(String(space.id));
        return {
          id: `hosted-${relation?.id || space.id}`,
          entity_type: space.type,
          business_kind: space.business_kind,
          role: null,
          area_label: "Tienda del Space",
          internal_role: "manager",
          membership_status: "active",
          request_status: null,
          can_manage: true,
          studio_os_active: true,
          enabled_modules: Array.isArray(space.enabled_modules) ? space.enabled_modules : [],
          admin_href: space.legacy_commerce_spot_id ? `/businesses/${space.id}` : null,
          team_href: `/businesses/${space.id}/team`,
          access_source: "host_space",
          host_space_id: relation?.hostSpaceId ?? null,
          space,
          studio: null,
        };
      });

    return NextResponse.json({ spaces });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron cargar las tiendas administradas por tus Spaces.";
    return NextResponse.json({ error: message }, { status: isAuthError(error) ? 401 : 500 });
  }
}
