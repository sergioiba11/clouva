import { NextRequest, NextResponse } from "next/server";
import { requireSpaceTeamReviewAccess } from "@/lib/server/space-team-access";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { spaceId } = await params;
    const admin = createAdminSupabase();
    const reviewerRole = await requireSpaceTeamReviewAccess(admin, user.id, spaceId);

    const [spaceResult, membersResult] = await Promise.all([
      admin.from("spaces").select("id,slug,name,type,business_kind,logo_url,cover_url,legacy_studio_id,legacy_commerce_spot_id,enabled_modules").eq("id", spaceId).maybeSingle(),
      admin.from("space_members").select("id,space_id,player_id,role,status,created_at,updated_at,player:players(id,display_name,username,profile_image_url,owner_user_id)").eq("space_id", spaceId).order("created_at"),
    ]);
    if (spaceResult.error) throw new Error(spaceResult.error.message);
    if (membersResult.error) throw new Error(membersResult.error.message);
    if (!spaceResult.data) return NextResponse.json({ error: "Espacio inexistente." }, { status: 404 });

    return NextResponse.json({
      space: spaceResult.data,
      reviewerRole,
      members: (membersResult.data ?? []).filter((member) => member.status === "active"),
      invitations: (membersResult.data ?? []).filter((member) => member.status === "invited"),
    });
  } catch (error) {
    const typed = error as Error & { status?: number; code?: string };
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo cargar el equipo.", ...(typed.code ? { code: typed.code } : {}) },
      { status: typed.status ?? (isAuthError(error) ? 401 : 500) },
    );
  }
}
